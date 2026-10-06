async def test_register_login_and_logout(client):
    credentials = {"email": "Student@amu.edu.pl", "password": "long-password"}

    registered = await client.post("/auth/register", json=credentials)
    duplicate = await client.post("/auth/register", json=credentials)
    wrong = await client.post("/auth/login", json={**credentials, "password": "wrong-password"})
    login = await client.post("/auth/login", json={**credentials, "email": "student@amu.edu.pl"})
    headers = {"Authorization": f"Bearer {login.json()['token']}"}
    me = await client.get("/auth/me", headers=headers)
    logout = await client.post("/auth/logout", headers=headers)
    after = await client.get("/auth/me", headers=headers)

    assert registered.status_code == 201
    assert duplicate.status_code == 409
    assert wrong.status_code == 401
    assert me.json() == {"email": "student@amu.edu.pl"}
    assert logout.status_code == 204
    assert after.status_code == 401


async def test_short_password_is_rejected(client):
    response = await client.post("/auth/register", json={"email": "a@amu.edu.pl", "password": "short"})
    assert response.status_code == 422


async def test_data_requires_session(client):
    assert (await client.get("/assignments")).status_code == 401
