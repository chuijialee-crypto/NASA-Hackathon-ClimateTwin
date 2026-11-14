"""The 8-value climate signature. Pure functions: DataFrame in, dict out.

Input: daily DataFrame with a DatetimeIndex and columns
T2M, T2M_MAX, PRECTOTCORR, ALLSKY_SFC_SW_DWN (missing values as NaN).

Every "per year" value is a daily average scaled by DAYS_PER_YEAR, so a window
of any length (1 year or 40) gives a comparable number, and missing days
shrink the sample instead of counting as zero.
"""

import numpy as np
import pandas as pd

GDD_BASE_C = 10.0          # growing degree days base temperature
HEAT_STRESS_C = 35.0       # T2M_MAX above this is a heat-stress day
DRY_DAY_MM = 1.0           # a day with less rain than this is "dry"
WET_SEASON_MONTHS = 3      # wet season = the wettest 3 consecutive months
DAYS_PER_YEAR = 365.25
MIN_VALID_FRACTION = 0.9   # refuse to compute if more than 10% of a column is missing

SIGNATURE_KEYS = [
    "mean_temp", "gdd", "rain_mm", "wet_share",
    "dry_spell_days", "heat_days", "solar", "cold_month",
]
REQUIRED_COLUMNS = ["T2M", "T2M_MAX", "PRECTOTCORR", "ALLSKY_SFC_SW_DWN"]


def check_input(daily: pd.DataFrame) -> None:
    """Fail loudly on missing columns or too much missing data."""
    missing = [c for c in REQUIRED_COLUMNS if c not in daily.columns]
    if missing:
        raise ValueError(f"daily data is missing columns: {missing}")
    if not isinstance(daily.index, pd.DatetimeIndex):
        raise ValueError("daily data must be indexed by date")
    if len(daily) == 0:
        raise ValueError("daily data is empty")
    for column in REQUIRED_COLUMNS:
        valid = daily[column].notna().mean()
        if valid < MIN_VALID_FRACTION:
            raise ValueError(f"{column}: only {valid:.0%} of days have data")


def per_year(daily_values: pd.Series) -> float:
    """Average per day (over valid days only) scaled to one year."""
    return float(daily_values.mean() * DAYS_PER_YEAR)


def mean_temp(daily: pd.DataFrame) -> float:
    """Mean annual temperature (°C)."""
    return float(daily["T2M"].mean())


def growing_degree_days(daily: pd.DataFrame) -> float:
    """Growing degree days per year: sum of max(T2M - 10, 0)."""
    degrees_above_base = (daily["T2M"] - GDD_BASE_C).clip(lower=0).where(daily["T2M"].notna())
    return per_year(degrees_above_base)


def annual_rain(daily: pd.DataFrame) -> float:
    """Total rainfall per year (mm)."""
    return per_year(daily["PRECTOTCORR"])


def wet_season_share(daily: pd.DataFrame) -> float:
    """Fraction of annual rain that falls in the wettest 3 consecutive months.

    Uses the average rainfall of each calendar month, wrapping Dec -> Jan.
    Even rain gives 0.25; a sharp monsoon gives a value near 1.
    """
    monthly = daily["PRECTOTCORR"].groupby(daily.index.month).mean()
    monthly = monthly.reindex(range(1, 13))
    if monthly.isna().any():
        raise ValueError("wet_share needs data in every calendar month")
    # Daily means are scaled by days per month so months weigh by how much rain they hold.
    days_in_month = np.array([31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])
    totals = monthly.to_numpy() * days_in_month
    wrapped = np.concatenate([totals, totals[:WET_SEASON_MONTHS - 1]])
    windows = np.convolve(wrapped, np.ones(WET_SEASON_MONTHS), mode="valid")
    return float(windows.max() / totals.sum())


def longest_run(flags: np.ndarray) -> int:
    """Length of the longest run of True values."""
    best = current = 0
    for flag in flags:
        current = current + 1 if flag else 0
        best = max(best, current)
    return best


def longest_dry_spell(daily: pd.DataFrame) -> float:
    """Longest run of days with < 1 mm rain, averaged over the calendar years.

    A missing day breaks a run (we never assume it was dry).
    """
    rain = daily["PRECTOTCORR"]
    is_dry = (rain < DRY_DAY_MM).to_numpy()  # NaN compares False
    years = daily.index.year.to_numpy()
    spells = [longest_run(is_dry[years == year]) for year in np.unique(years)]
    return float(np.mean(spells))


def heat_stress_days(daily: pd.DataFrame) -> float:
    """Days per year with T2M_MAX above 35 °C."""
    hot = (daily["T2M_MAX"] > HEAT_STRESS_C).astype(float).where(daily["T2M_MAX"].notna())
    return per_year(hot)


def mean_solar(daily: pd.DataFrame) -> float:
    """Mean surface shortwave radiation (MJ/m²/day)."""
    return float(daily["ALLSKY_SFC_SW_DWN"].mean())


def coldest_month_temp(daily: pd.DataFrame) -> float:
    """Mean temperature of the coldest calendar month (°C)."""
    monthly = daily["T2M"].groupby(daily.index.month).mean()
    return float(monthly.min())


def signature(daily: pd.DataFrame) -> dict:
    """The 8 climate signature values, keyed as in contract.json."""
    check_input(daily)
    return {
        "mean_temp": mean_temp(daily),
        "gdd": growing_degree_days(daily),
        "rain_mm": annual_rain(daily),
        "wet_share": wet_season_share(daily),
        "dry_spell_days": longest_dry_spell(daily),
        "heat_days": heat_stress_days(daily),
        "solar": mean_solar(daily),
        "cold_month": coldest_month_temp(daily),
    }
