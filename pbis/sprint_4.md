# Sprint 4

## Sprint Goal

Expand BucHunt to support additional task types and administrative task management while preserving reliable player behavior and automated delivery.

## PBI 1: Edit and Delete Hunt Tasks

### Priority: High

### User Story

As an administrator, I want to edit and delete hunt tasks, so that I can maintain a hunt's configuration as its requirements change.

### Acceptance Criteria

- [ ] Given an administrator has access to an existing hunt, when they edit a task and save valid changes, then the updated task configuration is persisted.
- [ ] Given an administrator has access to an existing hunt, when they delete a task, then the task is no longer included in the hunt configuration.
- [ ] Given an administrator edits a task's configured answer, when a player subsequently submits an answer, then the current configured answer is used for validation.
- [ ] Given an administrative task modification fails validation, when the administrator attempts to save it, then the invalid configuration is not persisted.
- [ ] Given a task modification fails, when the administrator views the task, then the previously saved configuration remains unchanged.

## PBI 2: Support Multiple-Choice Hunt Tasks

### Priority: High

### User Story

As a player, I want to complete a multiple-choice hunt task, so that BucHunt can support more than free-text task responses.

### Acceptance Criteria

- [ ] Given an administrator has configured a multiple-choice task, when a player views the task, then the available choices are presented.
- [ ] Given a player selects the configured correct choice, when the answer is submitted, then the task is marked as completed.
- [ ] Given a player selects an incorrect choice, when the answer is submitted, then the task remains incomplete and the player receives appropriate feedback.
- [ ] Given a multiple-choice task has been configured, when its configuration is retrieved, then the information required to present and validate its choices is available.
- [ ] Given a player submits an answer for a multiple-choice task, when the application evaluates it, then the task's configured answer determines whether the response is correct.

## PBI 3: Support Single-Word Trivia Tasks

### Priority: Medium

### User Story

As a player, I want to answer a single-word trivia task, so that BucHunt can support trivia-based challenges.

### Acceptance Criteria

- [ ] Given an administrator has configured a single-word trivia task, when a player views the task, then the task's question or prompt is presented.
- [ ] Given a player submits the configured answer, when the answer is validated, then the task is marked as completed.
- [ ] Given a player submits an answer that does not match the configured answer, when the answer is validated, then the task remains incomplete and the player receives appropriate feedback.
- [ ] Given a player submits an answer with differences in letter case or leading or trailing whitespace, when the application performs the configured answer comparison, then those differences do not incorrectly prevent a matching answer.
- [ ] Given a player submits an empty or whitespace-only answer, when the answer is evaluated, then the application rejects it and leaves the task incomplete.

## PBI 4: Configure Hunt Task Presentation

### Priority: Medium

### User Story

As an administrator, I want to configure how hunt tasks are presented, so that a hunt can use the intended task progression.

### Acceptance Criteria

- [ ] Given a hunt contains multiple tasks, when an administrator configures their presentation order, then the configured order is persisted with the hunt.
- [ ] Given a hunt uses fixed task presentation, when a player views the hunt, then the tasks are presented according to the configured order.
- [ ] Given a hunt uses a supported non-fixed presentation mode, when a player accesses the hunt, then the application presents tasks according to the configured mode.
- [ ] Given the task presentation configuration is changed, when the hunt configuration is retrieved, then the current presentation configuration is returned.
- [ ] Given a hunt's presentation configuration is invalid, when an administrator attempts to save it, then the invalid configuration is rejected and the last valid configuration is preserved.

## PBI 5: Verify Expanded Hunt Behavior Through Automated Delivery

### Priority: Medium

### User Story

As a Scrum Team, I want the expanded hunt capabilities to be automatically tested and delivered, so that new task behavior can be demonstrated without regressing existing functionality.

### Acceptance Criteria

- [ ] Given the Sprint 4 capabilities have been implemented, when the automated test suite runs, then the defined administrative and player behaviors are verified.
- [ ] Given the existing Sprint 3 player workflow is exercised, when the Sprint 4 automated tests execute, then the existing workflow continues to pass.
- [ ] Automated tests verify that valid task edits are saved, task deletions are reflected in the hunt configuration, and invalid modifications are rejected.
- [ ] Automated tests verify correct and incorrect answers for multiple-choice and single-word trivia tasks.
- [ ] Automated tests verify that configured task presentation settings are saved and applied when a player views the hunt.
- [ ] Given the Sprint 4 changes pass the required automated checks, when the continuous delivery process executes, then the updated application is deployed to the appropriate environment.
- [ ] Given deployment and deployment verification succeed, when the Sprint increment is demonstrated, then the expanded administrative and player workflows can be demonstrated through the deployed application.
- [ ] Given an automated check or deployment verification fails, when the delivery process reports its result, then the failure is visible and the affected increment is not reported as successfully verified.
