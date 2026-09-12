"""Focused schema contract tests for the package editor payload (Task A).

Covers the regression where PUT discarded activity editor fields, plus the
component-level validation rules from section 1 of the plan: omission vs
empty vs explicit-null replacement semantics, relative-only drafts, invalid
time/date intervals, non-finite numbers, and duplicate day/media IDs.
"""

import json
import re
from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from app.packages.schemas import (
    ActivityDetailOut,
    ActivityInput,
    FlightDetailOut,
    FlightInput,
    HotelDetailOut,
    HotelInput,
    PackageDayInput,
    PackageDayOut,
    TravelPackageUpdate,
)


def test_update_retains_activity_editor_fields():
    activity = {
        "activity_name": "Market walk",
        "activity_date": "2026-10-01",
        "city": "Tokyo",
        "day_number": 1,
        "sequence_order": 2,
        "start_time": "10:30",
        "duration_hours": 1.5,
        "price_aud": 40,
        "category": "Food",
        "address": "Market entrance",
        "notes": "Meet beside the gate",
        "media_ids": [],
    }
    saved = TravelPackageUpdate.model_validate({"activities": [activity]})
    body = saved.model_dump(mode="json", exclude_unset=True)
    assert body["activities"][0] == activity


def test_update_omitting_collections_means_unchanged():
    saved = TravelPackageUpdate.model_validate({"title": "New title"})
    body = saved.model_dump(mode="json", exclude_unset=True)
    assert "flights" not in body
    assert "hotels" not in body
    assert "activities" not in body


def test_update_empty_array_clears_collection():
    saved = TravelPackageUpdate.model_validate({"activities": []})
    body = saved.model_dump(mode="json", exclude_unset=True)
    assert body["activities"] == []


@pytest.mark.parametrize("field", ["flights", "hotels", "activities"])
def test_update_explicit_null_collection_is_rejected(field):
    with pytest.raises(ValidationError):
        TravelPackageUpdate.model_validate({field: None})


def test_update_days_null_stays_unchanged_for_compatibility():
    saved = TravelPackageUpdate.model_validate({"days": None})
    body = saved.model_dump(mode="json", exclude_unset=True)
    assert body["days"] is None


def test_update_days_empty_array_clears_narratives():
    saved = TravelPackageUpdate.model_validate({"days": []})
    body = saved.model_dump(mode="json", exclude_unset=True)
    assert body["days"] == []


def test_full_flight_input_round_trips_new_fields():
    flight = {
        "origin_iata": "SYD",
        "destination_iata": "NRT",
        "airline": "Qantas",
        "flight_number": "QF1",
        "departure_datetime": "2026-10-01T09:00:00",
        "arrival_datetime": "2026-10-01T18:00:00",
        "cabin_class": "Economy",
        "price_aud": 1200,
        "day_number": 1,
        "sequence_order": 1,
        "notes": "Window seat",
        "media_ids": [],
        "source_id": "catalog-flight-1",
    }
    parsed = FlightInput.model_validate(flight)
    assert parsed.model_dump(mode="json", exclude_unset=True) == flight


def test_full_hotel_input_round_trips_new_fields():
    hotel = {
        "hotel_name": "Park Hyatt",
        "star_rating": 5,
        "city": "Tokyo",
        "address": "3-7-1-2 Nishi Shinjuku",
        "check_in_date": "2026-10-01",
        "check_out_date": "2026-10-03",
        "price_per_night_aud": 500,
        "room_type": "Deluxe",
        "check_in_day": None,
        "check_out_day": None,
        "sequence_order": 1,
        "notes": "High floor",
        "media_ids": [],
        "source_id": "catalog-hotel-1",
    }
    parsed = HotelInput.model_validate(hotel)
    assert parsed.model_dump(mode="json", exclude_unset=True) == hotel


def test_full_day_input_round_trips_new_fields():
    day = {"day_number": 1, "title": "Arrival", "summary": "Land and settle in", "meta": "note", "media_ids": []}
    parsed = PackageDayInput.model_validate(day)
    assert parsed.model_dump(mode="json", exclude_unset=True) == day


def test_activity_may_omit_date_when_day_number_supplied():
    activity = ActivityInput.model_validate(
        {
            "activity_name": "Undated market walk",
            "city": "Tokyo",
            "day_number": 2,
        }
    )
    assert activity.activity_date is None
    assert activity.day_number == 2


def test_activity_requires_date_or_day_number():
    with pytest.raises(ValidationError):
        ActivityInput.model_validate({"activity_name": "Mystery walk", "city": "Tokyo"})


def test_hotel_may_use_relative_day_bounds_without_dates():
    hotel = HotelInput.model_validate(
        {
            "hotel_name": "Relative Stay",
            "city": "Osaka",
            "check_in_day": 2,
            "check_out_day": 4,
        }
    )
    assert hotel.check_in_date is None
    assert hotel.check_out_day == 4


def test_hotel_requires_dates_or_day_bounds():
    with pytest.raises(ValidationError):
        HotelInput.model_validate({"hotel_name": "No bounds", "city": "Osaka"})


def test_hotel_check_out_day_must_follow_check_in_day():
    with pytest.raises(ValidationError):
        HotelInput.model_validate(
            {
                "hotel_name": "Backwards Stay",
                "city": "Osaka",
                "check_in_day": 4,
                "check_out_day": 2,
            }
        )


def test_hotel_check_out_date_must_follow_check_in_date():
    with pytest.raises(ValidationError):
        HotelInput.model_validate(
            {
                "hotel_name": "Backwards Stay",
                "city": "Osaka",
                "check_in_date": "2026-10-03",
                "check_out_date": "2026-10-01",
            }
        )


def test_flight_arrival_must_follow_departure():
    with pytest.raises(ValidationError):
        FlightInput.model_validate(
            {
                "origin_iata": "SYD",
                "destination_iata": "NRT",
                "airline": "Qantas",
                "departure_datetime": "2026-10-01T18:00:00",
                "arrival_datetime": "2026-10-01T09:00:00",
            }
        )


def test_activity_rejects_invalid_time_format():
    with pytest.raises(ValidationError):
        ActivityInput.model_validate(
            {
                "activity_name": "Bad time",
                "city": "Tokyo",
                "day_number": 1,
                "start_time": "25:99",
            }
        )


@pytest.mark.parametrize("value", [float("inf"), float("nan"), -1])
def test_activity_rejects_non_finite_or_negative_price(value):
    with pytest.raises(ValidationError):
        ActivityInput.model_validate(
            {
                "activity_name": "Bad price",
                "city": "Tokyo",
                "day_number": 1,
                "price_aud": value,
            }
        )


@pytest.mark.parametrize("value", [float("inf"), float("nan"), -1])
def test_activity_rejects_non_finite_or_negative_duration(value):
    with pytest.raises(ValidationError):
        ActivityInput.model_validate(
            {
                "activity_name": "Bad duration",
                "city": "Tokyo",
                "day_number": 1,
                "duration_hours": value,
            }
        )


def test_activity_rejects_duplicate_media_ids():
    dup = "11111111-1111-1111-1111-111111111111"
    with pytest.raises(ValidationError):
        ActivityInput.model_validate(
            {
                "activity_name": "Dup media",
                "city": "Tokyo",
                "day_number": 1,
                "media_ids": [dup, dup],
            }
        )


def test_update_rejects_duplicate_day_numbers():
    with pytest.raises(ValidationError):
        TravelPackageUpdate.model_validate(
            {
                "days": [
                    {"day_number": 1, "title": "A"},
                    {"day_number": 1, "title": "B"},
                ]
            }
        )


def test_activity_rejects_non_positive_sequence_order():
    with pytest.raises(ValidationError):
        ActivityInput.model_validate(
            {
                "activity_name": "Bad order",
                "city": "Tokyo",
                "day_number": 1,
                "sequence_order": 0,
            }
        )


# ─────────────────────────────────────────────
# Task E: OpenAPI / handover contract checks.
#
# These validate the *documents* (openapi.yaml, the FE handover markdown)
# against the runtime Pydantic models — not the database. No SQL runs here.
# ─────────────────────────────────────────────

_REPO_ROOT = Path(__file__).resolve().parents[3]
_OPENAPI_PATH = _REPO_ROOT / "apps" / "api" / "openapi.yaml"
_HANDOVER_PATH = _REPO_ROOT / "docs" / "frontend-package-save-submit-handover.md"


def _load_openapi():
    return yaml.safe_load(_OPENAPI_PATH.read_text())


def _resolve_local_ref(spec, ref: str):
    """Resolve a `#/a/b/c` local JSON pointer against the loaded spec."""
    assert ref.startswith("#/"), f"only local refs are supported, got {ref}"
    node = spec
    for part in ref[2:].split("/"):
        assert part in node, f"broken local ref: {ref} (missing segment {part!r})"
        node = node[part]
    return node


def _collect_refs(node, refs):
    if isinstance(node, dict):
        if "$ref" in node:
            refs.append(node["$ref"])
        for value in node.values():
            _collect_refs(value, refs)
    elif isinstance(node, list):
        for item in node:
            _collect_refs(item, refs)


def test_openapi_parses_and_resolves_all_local_refs():
    spec = _load_openapi()
    refs: list[str] = []
    _collect_refs(spec, refs)
    assert refs, "expected at least one $ref in the spec"
    for ref in refs:
        _resolve_local_ref(spec, ref)


def test_openapi_operation_ids_are_unique():
    spec = _load_openapi()
    operation_ids: list[str] = []
    for path_item in spec["paths"].values():
        for method, operation in path_item.items():
            if method not in ("get", "post", "put", "patch", "delete"):
                continue
            operation_id = operation.get("operationId")
            if operation_id:
                operation_ids.append(operation_id)
    duplicates = [oid for oid in set(operation_ids) if operation_ids.count(oid) > 1]
    assert not duplicates, f"duplicate operationId(s): {duplicates}"


def test_openapi_version_bumped_for_this_change():
    spec = _load_openapi()
    assert spec["info"]["version"] == "2.3.0"


@pytest.mark.parametrize(
    "schema_name,runtime_model",
    [
        ("FlightDetail", FlightDetailOut),
        ("HotelDetail", HotelDetailOut),
        ("ActivityDetail", ActivityDetailOut),
        ("PackageDay", PackageDayOut),
    ],
)
def test_openapi_component_schema_properties_match_runtime_model(
    schema_name, runtime_model
):
    """Every property the runtime *DetailOut/Out model can emit must be
    documented on the matching OpenAPI schema (directly, or via an allOf
    branch), and vice versa — a doc-only field is exactly the kind of drift
    this check exists to catch, not just a missing one. This is the
    "compare documented component/day properties ... with the runtime
    models" check the brief asks for.

    `required` is compared too, but only against each branch's own
    `required` key, without chasing into a $ref'd sub-schema (e.g.
    FlightDetail's allOf $refs FlightInput, whose `required` list is
    input-validation-only — it says nothing about what a lenient *DetailOut
    read model guarantees on output, per this file's own "everything
    optional" convention for *DetailOut/MediaItemOut).
    """
    spec = _load_openapi()
    schema = spec["components"]["schemas"][schema_name]

    documented_props: set[str] = set()
    documented_required: set[str] = set(schema.get("required", []) or [])
    branches = schema["allOf"] if "allOf" in schema else [schema]
    for branch in branches:
        documented_required.update(branch.get("required", []) or [])
        if "$ref" in branch:
            branch = _resolve_local_ref(spec, branch["$ref"])
            # Input schemas the *Detail branches ref may themselves be allOf;
            # flatten one more level (Detail = allOf[extra fields, Input]).
            sub_branches = branch["allOf"] if "allOf" in branch else [branch]
            for sub in sub_branches:
                if "$ref" in sub:
                    sub = _resolve_local_ref(spec, sub["$ref"])
                documented_props.update(sub.get("properties", {}).keys())
        else:
            documented_props.update(branch.get("properties", {}).keys())

    runtime_fields = set(runtime_model.model_fields.keys())
    runtime_required = {
        name for name, field in runtime_model.model_fields.items() if field.is_required()
    }

    assert documented_props == runtime_fields, (
        f"{schema_name}: doc-only={documented_props - runtime_fields}, "
        f"runtime-only={runtime_fields - documented_props}"
    )
    assert documented_required == runtime_required, (
        f"{schema_name}: required mismatch — doc-only={documented_required - runtime_required}, "
        f"runtime-only={runtime_required - documented_required}"
    )


def test_openapi_day_input_matches_package_day_input_model():
    spec = _load_openapi()
    schema = spec["components"]["schemas"]["PackageDayInput"]
    documented_required = set(schema.get("required", []))
    documented_props = set(schema.get("properties", {}).keys())

    runtime_fields = set(PackageDayInput.model_fields.keys())
    runtime_required = {
        name
        for name, field in PackageDayInput.model_fields.items()
        if field.is_required()
    }

    assert documented_props == runtime_fields, (
        f"PackageDayInput field mismatch: doc-only={documented_props - runtime_fields}, "
        f"runtime-only={runtime_fields - documented_props}"
    )
    assert documented_required == runtime_required


def test_handover_forbids_delete_and_readd_instruction():
    text = _HANDOVER_PATH.read_text()
    assert "delete and re-add" not in text.lower()


def test_handover_example_payload_validates_against_travel_package_update():
    """Extract the handover's fenced ```json example (the multi-night/flight
    example) and prove it actually parses as a valid TravelPackageUpdate —
    the payload the brief requires, not an invented one.
    """
    from app.packages.schemas import TravelPackageUpdate

    text = _HANDOVER_PATH.read_text()
    blocks = re.findall(r"```json\n(.*?)\n```", text, re.DOTALL)
    assert blocks, "expected at least one fenced json example in the handover"

    validated_any = False
    for block in blocks:
        try:
            payload = json.loads(block)
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict) or "title" not in payload:
            continue
        TravelPackageUpdate.model_validate(payload)
        validated_any = True

    assert validated_any, "no PUT-shaped example payload in the handover validated"


def test_handover_states_migration_not_deployed():
    """Match the actual claim, not just the presence of the words "not" and
    "deploy" anywhere in the document — that would still pass if the real
    caveat sentence were deleted while an unrelated heading (e.g. the FE
    follow-up section) happened to still contain "deployed"."""
    text = " ".join(_HANDOVER_PATH.read_text().split())  # normalize whitespace
    expected = (
        "The database migration "
        "(`supabase/migrations/0013_package_editor_persistence.sql`) has NOT been "
        "deployed"
    )
    expected_normalized = " ".join(expected.split())
    assert expected_normalized in text, (
        "handover must state, verbatim, that the migration has not been deployed"
    )
