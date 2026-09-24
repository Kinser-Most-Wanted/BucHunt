# PBI issue routing

The workflow at `.github/workflows/product-backlog.yml` processes changed `pbis/*.md` files on `main`. Each `# Sprint N` heading supplies an informational sprint label for the PBIs beneath it. Each PBI requires a `### Priority: High`, `Medium`, or `Low` line. The Product Owner sorts project cards into their final columns manually.

## One-time GitHub setup

1. Create an Actions repository secret named `PROJECTS_TOKEN`. Use a token from an account with access to both organization projects and Projects read/write permission (a classic personal access token needs the `project` scope). Keep it out of the repository.
2. The organization must have Projects named **Product Backlog** and **Sprint Backlog**. If your names differ, change `PRODUCT_BACKLOG_NAME` and `SPRINT_BACKLOG_NAME` in the workflow.
3. Set the Product Backlog board's column field to a single-select **Status** field with a **Catch All PBI** option. New issues start there, regardless of their sprint label.
4. Set the Sprint Backlog board's column field to **Status**. Leave its `No Status` column visible. If its built-in workflow sets Status when an item is added, disable that workflow so it does not override the automation's cleared Status.

The script adds the same issue to both projects. It sets Product Backlog Status to **Catch All PBI** and clears Sprint Backlog Status to place new issues in **No Status**. On reruns, it reuses existing issues and project items. It preserves both project columns on issues that existed before the run so manual sorting is not undone.

The workflow does not run when only its script or YAML changes. To retry previously created issues after setup, edit their source Markdown file in `pbis/` and push the change; the script will reuse the issues and add missing project entries.
