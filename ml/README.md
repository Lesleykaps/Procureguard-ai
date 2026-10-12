# ProcureGuard synthetic training data

`synthetic_procurement_transactions.csv` contains 12,000 generated procurement records for development and model-pipeline testing. It is entirely synthetic and must not be presented as evidence of real procurement fraud.

`benchmark_creditcard_fraud.mjs` is a separate external benchmark using Kaggle's `mlg-ulb/creditcardfraud` data. It uses a chronological split, applies SMOTE-style interpolation only to the training data, and writes `creditcard-benchmark-report.json`. Its results are evidence for the imbalance-handling methodology only; its anonymized credit-card features must not be claimed as procurement-model performance.

The generator creates an intentionally imbalanced target with approximately 15–20% labelled fraud cases. Fraud labels are generated from interpretable scenarios: duplicate invoices, invoice splitting, single-bid awards, overbilling, and vendor conflicts. The generator also adds noise so the task is not perfectly separable.

Rows are assigned deterministically to `train`, `validation`, or `test` using a stable hash of the transaction id. The training pipeline should fit preprocessing and SMOTE only on the `train` split, use `validation` for threshold selection, and reserve `test` for the final report.

Regenerate the dataset with:

```text
pnpm run data:generate
```

Train the local model artifacts and evaluate the held-out test split with:

```text
pnpm run models:train
```

The resulting `model-artifacts.json` records the feature set, SMOTE row counts, test metrics, confusion matrices, and model feature importance used by the model registry view.

## Reviewer-label retraining handoff

Admins and Managers can use **Models → Prepare training package** to download the latest eligible human review labels. A local candidate can then be trained with:

```text
pnpm run models:retrain:reviewed -- path/to/procureguard-reviewed-labels.csv
```

The command writes `ml/retraining-candidate.json` with a compact logistic-regression candidate, reviewer-derived threshold proposal, and (when enough labels exist) a deterministic stratified holdout evaluation. It never replaces the active `model-artifacts.json`; the candidate remains `pending_approval` until the holdout gate and model-governance approval are complete. Aim for at least 30 real labeled cases with both classes so the holdout is meaningful before making performance claims.

The generated file is a development fixture. Replace it with approved, de-identified data before making claims about production accuracy or false-positive performance.
