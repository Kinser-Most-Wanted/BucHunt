# PBI and sprint-goal issue creation

The workflow at `.github/workflows/product-backlog.yml` processes changed `pbis/*.md` files on `main` and `automate-pbis`. Each `# Sprint N` heading supplies an informational sprint label for the PBIs beneath it. A `**Sprint Goal**`, `### Sprint Goal`, or `SPRINT GOAL:` line followed by goal text before the first PBI creates a separate `Sprint N Goal` issue. Its body begins `SPRINT GOAL:` and it receives `Sprint Goal` and `Sprint N` labels. Each PBI requires a `### Priority: High`, `Medium`, or `Low` line. Each PBI receives `PBI` and `Sprint N` labels and a priority suffix (`- H`, `- M`, or `- L`) in its title.

## GitHub setup and behavior

The workflow uses the built-in `GITHUB_TOKEN` with `contents: read` and `issues: write` permissions. No project token or board configuration is required.

The script creates repository issues only. It does not look up projects, add issues to the Product Backlog or Sprint Backlog, or change project statuses. The Product Owner adds issues to boards and sorts them manually. Existing board items are not changed. Any independently configured GitHub project auto-add workflows are managed separately in the project settings.

On reruns, the script reuses existing issues with matching titles rather than creating duplicates. It does not update their bodies or labels.

The workflow does not run when only its script or YAML changes. To process a Markdown file again, edit its source in `pbis/` and push the change.
