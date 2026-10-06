from uni.sources.usos.oauth import Consumer, Token, signed_params


def test_signature_matches_rfc5849_example():
    params = signed_params(
        "GET",
        "http://photos.example.net/photos",
        {"file": "vacation.jpg", "size": "original"},
        Consumer("dpf43f3p2l4k3l03", "kd94hf93k423kf44"),
        Token("nnch734d00sl2jdk", "pfkkdhi9sl3r4s00"),
        nonce="kllo9940pd9333jh",
        timestamp=1191242096,
    )
    assert params["oauth_signature"] == "tR3+Ty81lMeYAr/Fid0kMTYa/WM="
