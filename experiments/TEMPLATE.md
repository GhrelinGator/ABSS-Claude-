# Preregistration: E<id> <title>

- **Date written:** (before any runs)
- **Commit:** (hash of the code that will be run)
- **Author/model:**

## Question
One sentence. Link the claim in `ORIGIN.md` or the chain in `DESIGN.md` §7 it tests.

## Conditions
| Condition | What changes | Everything else |
|---|---|---|
| Treatment | | identical |
| Null / ablation | the enabling mechanism removed | identical |

## Detectors
For each detector (`DESIGN.md` §8.2): exact operational definition, time window, and the **threshold** that counts as "present."

## Positive control
Which test fixture shows the detector fires when the phenomenon is there.

## Predictions
What each condition should show if the hypothesis is right, and what would count as evidence against it. State this before running. Both outcomes are publishable.

## Runs
Seeds, run length, population, map. Justify the sample size.

## Analysis plan
Effect size measure, how spread across seeds is reported, permutation tests for network metrics.
