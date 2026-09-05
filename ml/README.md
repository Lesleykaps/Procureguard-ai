# ProcureGuard synthetic training data

`synthetic_procurement_transactions.csv` contains 12,000 generated procurement records for development and model-pipeline testing. It is entirely synthetic and must not be presented as evidence of real procurement fraud.

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

The generated file is a development fixture. Replace it with approved, de-identified data before making claims about production accuracy or false-positive performance.
