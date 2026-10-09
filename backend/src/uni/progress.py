from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from uni.aggregator import SNAPSHOT_VERSION
from uni.domain import Completion, SourceKind
from uni.models import Snapshot, SourceLink, User
from uni.registry import SourceRegistry


class MoodleNotLinked(Exception):
    pass


class Progress:
    def __init__(self, db: AsyncSession, registry: SourceRegistry, user: User):
        self.db = db
        self.registry = registry
        self.user = user

    async def set_completion(self, course_id: str, item_id: str, completed: bool) -> None:
        link = await self.db.scalar(
            select(SourceLink).where(SourceLink.user_id == self.user.id, SourceLink.kind == SourceKind.MOODLE)
        )
        if link is None or link.expired:
            raise MoodleNotLinked
        await self.registry.build(link).set_completion(item_id, completed)
        snapshot = await self.db.get(
            Snapshot, (self.user.id, SourceKind.MOODLE, f"sections:{course_id}@v{SNAPSHOT_VERSION}")
        )
        if snapshot is not None:
            state = Completion.COMPLETE if completed else Completion.INCOMPLETE
            snapshot.payload = [
                section
                | {
                    "items": [
                        item | {"completion": state} if item["id"] == item_id else item
                        for item in section["items"]
                    ]
                }
                for section in snapshot.payload
            ]
            await self.db.commit()
