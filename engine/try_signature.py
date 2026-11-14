"""Quick check: fetch the Kedah demo field and print its signature.

Run from the project root:  python -m engine.try_signature
"""

from engine.power_client import get_daily
from engine.signature import SIGNATURE_KEYS, signature

KEDAH_LAT, KEDAH_LON = 6.12, 100.37
RECENT_START, RECENT_END = "2015-01-01", "2024-12-31"  # present-day window


def main() -> None:
    daily = get_daily(KEDAH_LAT, KEDAH_LON)
    print(f"Rows: {len(daily)}  ({daily.index.min().date()} to {daily.index.max().date()})")
    print(f"Missing days per column:\n{daily.isna().sum().to_string()}\n")

    for label, window in [
        ("Full history 1984-2024", daily),
        ("Present day 2015-2024", daily.loc[RECENT_START:RECENT_END]),
    ]:
        sig = signature(window)
        print(label)
        for key in SIGNATURE_KEYS:
            print(f"  {key:15s} {sig[key]:10.2f}")
        print()


if __name__ == "__main__":
    main()
