import uuid

from fastapi import APIRouter, HTTPException, status

from uni.api.deps import SubjectsDep
from uni.api.schemas import SubjectIn, SubjectOut
from uni.subjects import SubjectNotFound

router = APIRouter(prefix="/subjects", tags=["subjects"])


@router.get("")
async def list_subjects(subjects: SubjectsDep) -> list[SubjectOut]:
    return [SubjectOut.of(view) for view in await subjects.list()]


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_subject(body: SubjectIn, subjects: SubjectsDep) -> SubjectOut:
    return SubjectOut.of(await subjects.create(body.data()))


@router.put("/{subject_id}")
async def update_subject(subject_id: uuid.UUID, body: SubjectIn, subjects: SubjectsDep) -> SubjectOut:
    try:
        return SubjectOut.of(await subjects.update(subject_id, body.data()))
    except SubjectNotFound as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "subject not found") from error


@router.delete("/{subject_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_subject(subject_id: uuid.UUID, subjects: SubjectsDep) -> None:
    try:
        await subjects.delete(subject_id)
    except SubjectNotFound as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "subject not found") from error
