import json

import pytest

from app.ai import engine


def test_clock_conversions_round_trip_and_clamp():
    assert engine._clock_to_hours("14:30") == 14.5
    assert engine._clock_to_hours("not a time") == -1.0
    assert engine._hours_to_clock(14.5) == "14:30"
    assert engine._hours_to_clock(9.9999) == "10:00"
    assert engine._hours_to_clock(-3) == "00:00"
    assert engine._hours_to_clock(30) == "23:59"


def test_parse_llm_response_strips_fences_and_prose():
    assert engine.parse_llm_response('```json\n{"a": 1}\n```') == {"a": 1}
    assert engine.parse_llm_response('Here you go: {"a": 1} hope it helps') == {"a": 1}


def test_parse_llm_response_repairs_commas():
    assert engine.parse_llm_response('{"a": [1, 2,], "b": 3,}') == {"a": [1, 2], "b": 3}
    assert engine.parse_llm_response('{\n  "a": "x"\n  "b": 2\n}') == {"a": "x", "b": 2}


def test_parse_llm_response_rejects_empty_and_unrepairable_input():
    with pytest.raises(json.JSONDecodeError):
        engine.parse_llm_response("")
    with pytest.raises(json.JSONDecodeError):
        engine.parse_llm_response('{"a": }')


def _trip(dates, **trip):
    return {
        "trip": {"travel_dates": {"depart_date": "2025-06-01", "return_date": "2025-06-03"}, **trip},
        "days": [{"date": date} for date in dates],
    }


def test_sync_travel_dates_follows_the_days():
    itinerary = engine._sync_travel_dates(_trip(["2026-04-10T00:00:00", "2026-04-11", "2026-04-12"]))
    assert itinerary["trip"]["travel_dates"] == {"depart_date": "2026-04-10", "return_date": "2026-04-12"}
    assert itinerary["validation"]["warnings"]


def test_sync_travel_dates_leaves_an_empty_itinerary_alone():
    itinerary = {"trip": {"travel_dates": {"depart_date": "2025-06-01"}}, "days": []}
    assert engine._sync_travel_dates(itinerary)["trip"]["travel_dates"] == {"depart_date": "2025-06-01"}


def test_stay_length_is_one_night_less_than_the_trip():
    itinerary = _trip(["2026-04-10", "2026-04-11", "2026-04-12", "2026-04-13"], duration_days=4)
    itinerary["accommodation"] = [{"hotel_name": "One", "nights": 4, "price_per_night_aud": 100}]
    [hotel] = engine._enforce_stay_length(itinerary, {})["accommodation"]
    assert (hotel["nights"], hotel["check_in"], hotel["check_out"]) == (3, "2026-04-10", "2026-04-13")
    assert hotel["total_price_aud"] == 300


def test_split_stays_chain_and_total_the_trip():
    itinerary = _trip(["2026-04-10", "2026-04-11", "2026-04-12", "2026-04-13"], duration_days=4)
    itinerary["accommodation"] = [{"hotel_name": "A", "nights": 2}, {"hotel_name": "B", "nights": 2}]
    first, second = engine._enforce_stay_length(itinerary, {})["accommodation"]
    assert first["nights"] + second["nights"] == 3
    assert first["check_in"] == "2026-04-10"
    assert second["check_in"] == first["check_out"]
    assert second["check_out"] == "2026-04-13"


def test_title_day_count_matches_the_itinerary():
    fixed = engine._enforce_title_day_count({"trip": {"title": "5-Day Tokyo Food Trip", "duration_days": 4}})
    assert fixed["trip"]["title"] == "4-Day Tokyo Food Trip"
    kept = engine._enforce_title_day_count({"trip": {"title": "4 day Kyoto", "duration_days": 4}})
    assert kept["trip"]["title"] == "4 day Kyoto"
    assert "validation" not in kept
