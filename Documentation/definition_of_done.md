# Definition of Done

A feature is **Done** when it is a potentially shippable vertical slice that satisfies its acceptance criteria and has passed the team's quality and integration checks.

* **Requirements:** Acceptance criteria are satisfied and the feature provides the intended functionality.
* **Code Quality:** Code is peer reviewed, understandable, maintainable, and merged through the team's source-control process.
* **Testing:** Appropriate automated tests pass, including integration or end-to-end tests when applicable. Known critical defects are resolved or explicitly accepted.
* **CI/CD:** The change passes automated CI quality gates and can progress through the appropriate development, test, staging, and production environments.
* **Deployment:** The feature has been successfully deployed to an agreed environment and verified through the actual application.
* **Security:** Relevant authentication, authorization, input validation, and other security concerns have been addressed.
* **Observability:** Appropriate logging, error reporting, and/or monitoring are in place to help detect and diagnose problems.
* **Documentation:** Necessary technical, user, deployment, or configuration documentation is updated.
* **Release Ready:** The integrated feature does not break existing functionality and is ready to be included in a production release.

### Not Done

A feature is **not Done** if it only works locally, has not passed automated quality gates, has not been integrated and tested in the appropriate environment, or has known critical defects that prevent it from being safely released.

**Team shorthand:**
**Meets the requirement → reviewed → tested → integrated → deployed → verified → observable → documented → shippable.**
