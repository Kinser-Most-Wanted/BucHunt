# Estimation and Sprint Board

## Purpose

This document defines how the team will estimate work, organize sprint work, and manage the sprint board.

The team will use:

- Planning Poker for estimation
- Fibonacci points for relative sizing
- GitHub Projects for sprint board management
- GitHub Issues to break work into actionable tasks

---

## Estimation Technique

### Planning Poker
The team will estimate work using Planning Poker.

Planning Poker is useful because it:
- encourages discussion
- exposes uncertainty
- helps compare relative effort
- avoids one person dominating estimates too early

### Point Scale
The team will use Fibonacci-style story points:

- 1
- 2
- 3
- 5
- 8
- 13

These points represent relative effort, complexity, and uncertainty, not direct hours.

---

## Estimation Guidelines

When estimating, the team should consider:

- implementation complexity
- uncertainty or unknowns
- testing effort
- integration effort
- risk
- design effort if needed

### If estimates vary a lot
If people choose very different values:
- discuss assumptions
- identify what is unclear
- split the item if necessary
- estimate again after discussion

### If an item is too large
If a backlog item feels too large or unclear:
- do not force a number
- split it into smaller sprintable work
- refine it before committing it to a sprint

---

## Sprint Board Tool

The team will use **GitHub Projects** as the sprint board.

GitHub Projects will be used because it keeps work close to:
- the repository
- issues
- pull requests
- development workflow
- status visibility

---

## Issues and Tasking

The team will use **GitHub Issues** to represent work items and tasking.

### Expectations
- larger features can be represented as higher-level issues
- smaller implementation work can be broken into task-oriented issues
- issue descriptions should explain the goal clearly
- acceptance expectations should be included where practical
- related pull requests should be linked back to the issue

---

## Recommended Board Structure

Suggested board columns:

- Backlog
- Ready
- In Progress
- In Review
- Testing
- Done

Optional column:
- Blocked

### Column Meaning

#### Backlog
Work that exists but is not ready for the current sprint.

#### Ready
Work that is refined enough and ready to be pulled into active development.

#### In Progress
Work actively being implemented.

#### In Review
Work in pull request or under active peer review.

#### Testing
Work that is implemented and being validated in an actual environment.

#### Done
Work that meets the team’s Definition of Done.

#### Blocked
Work that cannot move forward because of a dependency or issue.

---

## How the Sprint Board Will Be Run

### Before Sprint Start
- identify the sprint goal
- move sprint-ready items into the sprint scope
- confirm work is understood well enough to begin
- estimate work using Planning Poker where needed

### During the Sprint
- update issue status regularly
- move items across the board as work progresses
- keep blockers visible
- avoid letting too many items sit in progress at the same time

### End of Sprint
- review what reached Done
- identify what remains incomplete
- carry unfinished work forward only if still valuable
- use sprint results to improve next sprint planning

---

## Working Agreement for Sprint Tracking

- all meaningful sprint work should exist as GitHub Issues
- issues should map back into concrete tasking
- the GitHub Project board should reflect real status
- work should not be marked Done until it meets the Definition of Done
- blocked work should be visible instead of hidden in progress
- the board should support sprint visibility, not just personal tracking

---

## Summary

For this team:

- estimation uses Planning Poker
- points use Fibonacci values
- GitHub Projects manages the sprint board
- GitHub Issues map work into tasking
- the board should reflect real progress through the sprint
