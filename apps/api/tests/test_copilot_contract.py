from pathlib import Path

import yaml

from app.main import app


def test_canonical_copilot_paths_and_models_match_live_api():
    spec = yaml.safe_load((Path(__file__).parents[1] / "openapi.yaml").read_text())
    live = app.openapi()
    for path, methods in live["paths"].items():
        if not path.startswith("/ai/copilot/"):
            continue
        for method, operation in methods.items():
            canonical = spec["paths"][path][method]
            assert canonical["security"] == [{"BearerAuth": []}]
            for status in ("200", "201"):
                if status in operation["responses"]:
                    assert (
                        canonical["responses"][status]["content"]
                        == operation["responses"][status]["content"]
                    )
            for code in ("401", "404", "422", "502", "503"):
                assert code in canonical["responses"]
    for name in (
        "TurnRead",
        "Suggestion",
        "TurnList",
        "PromptInput",
        "FeedbackInput",
    ):
        if name not in spec["components"]["schemas"]:
            # ModelOutput is internal, never an API response.
            assert name == "ModelOutput"
            continue
        documented = spec["components"]["schemas"][name]
        actual = live["components"]["schemas"][name]
        assert documented.get("required", []) == actual.get("required", [])
        assert documented["properties"].keys() == actual["properties"].keys()
    assert spec["components"]["schemas"]["FeedbackInput"]["properties"]["auto_apply"][
        "enum"
    ] == [False]
    assert (
        spec["components"]["schemas"]["PromptInput"]["properties"]["prompt"][
            "minLength"
        ]
        == 1
    )


def test_canonical_local_references_resolve():
    spec = yaml.safe_load((Path(__file__).parents[1] / "openapi.yaml").read_text())

    def walk(value):
        if isinstance(value, dict):
            if "$ref" in value and value["$ref"].startswith("#/"):
                target = spec
                for key in value["$ref"][2:].split("/"):
                    target = target[key]
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)

    walk(spec)
