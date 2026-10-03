"""Pass / review / reject decision for the vision inspector.

Scores are anomalib's normalized anomaly scores, where 0.5 is the model's
default threshold. The band was chosen on the MVTec AD metal_nut test set.
"""

PASS_BELOW = 0.35
REJECT_ABOVE = 0.55


def verdict(score: float) -> str:
    if score < PASS_BELOW:
        return "PASS"
    if score > REJECT_ABOVE:
        return "REJECT"
    return "REVIEW"
