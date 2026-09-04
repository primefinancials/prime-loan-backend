# Backend CI/CD

`deploy-backend.yml` ships the backend to AWS Elastic Beanstalk.

| Trigger | Target |
|---|---|
| push to **`staging-v2`** | `pf-staging` |
| push to **`v2`** | `pf-prod` |
| **Run workflow** (manual) | pick `pf-staging` or `pf-prod` |

Both environments are in AWS account **018088156887**, region **eu-west-1**,
EB application **prime-finance-backend**. Pushes that only touch `docs/`,
`*.md` or `.github/` are skipped.

The bundle is `git archive HEAD` (committed source only — `docs/` and
`.github/` are stripped via `.gitattributes` `export-ignore`). The instance
runs `npm install` + `npm run build` itself through `.platform/hooks`, exactly
as `eb deploy` does.

## One-time setup

### 1. IAM user for the pipeline

Create an IAM user (e.g. `github-actions-deployer`) with programmatic access and
attach the AWS-managed policy **`AdministratorAccess-AWSElasticBeanstalk`** plus
this inline policy for the S3 upload:

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": ["s3:PutObject", "s3:GetObject", "s3:ListBucket"],
    "Resource": [
      "arn:aws:s3:::elasticbeanstalk-eu-west-1-018088156887",
      "arn:aws:s3:::elasticbeanstalk-eu-west-1-018088156887/*"
    ]
  }]
}
```

### 2. Repository secrets

`Settings > Secrets and variables > Actions`:

| Secret | Value |
|---|---|
| `AWS_ACCESS_KEY_ID` | the IAM user's access key id |
| `AWS_SECRET_ACCESS_KEY` | the IAM user's secret access key |

Then, in the same screen, add a **Variable** (not a secret):

| Variable | Value |
|---|---|
| `BACKEND_DEPLOY_ENABLED` | `true` |

Until that variable is `true`, push-triggered runs are **skipped** (they show
as "skipped", not failed). Manual **Run workflow** always runs.

### 3. GitHub Environments (optional but recommended)

`Settings > Environments` — create **`production`** and **`staging`**.
On `production` add **Required reviewers** so every `v2` deploy waits for an
approval click. Deploys still build immediately; only the "Deploy to pf-prod"
step blocks until approved.

## Notes

- `workflow_dispatch` with `target: pf-prod` deploys **whatever branch you run
  it from** — normally run it from `v2`.
- The job fails if `/health` doesn't return 200 within ~2 min of the env
  reporting updated.
- Env vars are **not** managed here — set those with `eb setenv` /
  the EB console. The pipeline only ships code.
