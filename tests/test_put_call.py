from hfgi_pro.put_call import put_call_ratio_to_score


def test_put_call_ratio_at_or_below_greed_band_scores_100():
    assert put_call_ratio_to_score(0.7) == 100.0
    assert put_call_ratio_to_score(0.3) == 100.0


def test_put_call_ratio_at_or_above_fear_band_scores_0():
    assert put_call_ratio_to_score(1.3) == 0.0
    assert put_call_ratio_to_score(2.0) == 0.0


def test_put_call_ratio_midpoint_scores_50():
    assert put_call_ratio_to_score(1.0, greed_ratio=0.7, fear_ratio=1.3) == 50.0


def test_put_call_ratio_is_monotonically_decreasing_in_between():
    scores = [put_call_ratio_to_score(r) for r in [0.7, 0.9, 1.0, 1.1, 1.3]]
    assert scores == sorted(scores, reverse=True)
