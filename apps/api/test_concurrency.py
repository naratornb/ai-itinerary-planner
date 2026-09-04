import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from dotenv import load_dotenv
load_dotenv(".env")

from ai.llm_provider import call_llm


def test_one_request(request_id):
    start = time.perf_counter()

    try:
        response = call_llm(
            system_prompt="Reply with one short sentence.",
            user_prompt=f"Hello, this is concurrent request {request_id}.",
            max_tokens=200,
        )

        return {
            "id": request_id,
            "success": True,
            "time": time.perf_counter() - start,
            "tokens_in": response.tokens_in,
            "tokens_out": response.tokens_out,
            "provider": response.provider,
            "error": None,
        }

    except Exception as e:
        return {
            "id": request_id,
            "success": False,
            "time": time.perf_counter() - start,
            "tokens_in": 0,
            "tokens_out": 0,
            "provider": None,
            "error": str(e),
        }


def run_test(concurrency):
    print("\n" + "=" * 60)
    print(f"TESTING {concurrency} SIMULTANEOUS REQUESTS")
    print("=" * 60)

    start = time.perf_counter()

    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = [
            executor.submit(test_one_request, i + 1)
            for i in range(concurrency)
        ]

        results = [f.result() for f in as_completed(futures)]

    total_time = time.perf_counter() - start
    results.sort(key=lambda x: x["id"])

    successful = sum(r["success"] for r in results)
    failed = len(results) - successful

    print(f"\nTotal time: {total_time:.2f}s")
    print(f"Successful: {successful}/{concurrency}")
    print(f"Failed:     {failed}/{concurrency}")

    for r in results:
        if r["success"]:
            print(
                f"Request {r['id']:2d}: SUCCESS "
                f"| {r['time']:.2f}s "
                f"| {r['tokens_in']} in / {r['tokens_out']} out"
            )
        else:
            print(
                f"Request {r['id']:2d}: FAILED "
                f"| {r['time']:.2f}s "
                f"| {r['error']}"
            )


if __name__ == "__main__":
    print("Gemini concurrency test")

    for concurrency in [1, 2, 5, 10]:
        run_test(concurrency)

        print("\nWaiting 3 seconds...")
        time.sleep(3)
