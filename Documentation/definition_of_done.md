# Definition of Done

## Purpose

This document defines when a feature is considered done by the team. A feature is not done simply because code exists. It is done only when it meets the agreed implementation, review, testing, and integration expectations.

---

## Definition of Done for a Feature

A feature is considered done when all of the following are true:

- it accomplishes the goal it was intended to do
- it passes automated testing
- it has been peer reviewed twice on the feature branch
- it has been tested in an actual environment
- it has been reviewed again in `stage` before going into `main`

---

## Expanded Definition

### 1. The Feature Accomplishes the Intended Goal
The feature must do what it was created to do.

This means:
- the implementation matches the agreed requirement or task
- acceptance expectations are satisfied
- the feature behaves correctly in the intended context

A feature is not done if it is only partially complete or if key expected behavior is missing.

---

## 2. Automated Testing Passes
The feature must pass whatever automated testing is in place for the project.

This means:
- automated checks complete successfully
- no known failing checks remain
- no one bypasses automated checks just to merge quickly

If the project has limited automated testing, then the existing automated quality gates still need to pass.

---

## 3. The Feature Branch Receives Two Peer Reviews
Before a feature can move into `stage`, it must be reviewed twice on the feature branch.

This means:
- two peers review the implementation
- review comments are addressed
- the change is understandable and maintainable
- the reviewers agree the feature is ready for integration

The goal is to reduce avoidable defects before integration.

---

## 4. The Feature Is Tested in an Actual Environment
The feature must be tested in a real environment, not just assumed correct from reading code.

This means:
- it is run in the actual project environment
- behavior is checked through the real application flow
- Docker-based local testing or another agreed actual environment is used
- major intended paths are verified

A feature is not done if it only appears correct on paper but has not been exercised in a real environment.

---

## 5. The Feature Is Reviewed Again in `stage`
Before work goes from `stage` into `main`, the integrated result must be reviewed in `stage`.

This means:
- the feature still behaves correctly once integrated
- no new issues appeared because of other merged work
- the current release candidate in `stage` is acceptable for release
- the team has confidence in moving the integrated work into `main`

---

## What Does Not Count as Done

A feature is not done if:

- it only works on one machine
- it was coded but not reviewed
- it was reviewed only once
- it passes local testing but not automated checks
- it works in isolation but was not validated in `stage`
- it still has major known defects related to the intended feature
- it does not actually achieve the goal it was supposed to achieve

---

## Team Summary

For this team, done means:

- built correctly
- checked automatically
- reviewed twice on the feature branch
- tested in a real environment
- reviewed in `stage`
- ready to safely move toward `main`
