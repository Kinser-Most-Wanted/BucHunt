# Sprint 5

## Sprint Goal

Enable administrators to prepare hunts for players, monitor participation, and review results while ensuring hunts remain reliable during player activity.

## PBI 1: Enforce Sequential Hunt Task Progression

### Priority: High

### User Story

As a player, I want hunt tasks to become available one at a time, so that I can complete the hunt in the intended order without skipping ahead.

### Acceptance Criteria

- [ ] Given a player joins a hunt configured for sequential tasks, when they view the hunt, then only the first incomplete task is available, and future tasks remain hidden.
- [ ] Given a player completes the current task, when their answer is successfully validated, then the next task becomes visible and available for completion.
- [ ] Given a player attempts to access or submit an answer for a future task before completing the required previous task, when the request is processed, then the application prevents access or completion.
- [ ] Given a player leaves and returns to a sequential hunt, when their saved progress is restored, then previously completed tasks remain completed and only the next incomplete task is available.

## PBI 2: Display Hunt Completion Summary

### Priority: Medium

### User Story

As a player, I want to see a summary when I finish a hunt, so that I know I have successfully completed all required tasks.

### Acceptance Criteria

- [ ] Given a player completes the final required task in a hunt, when their answer is successfully validated, then the application displays a message confirming that the hunt is complete.
- [ ] Given a player has completed all required tasks, when they view their hunt summary, then the application displays the total number of completed tasks.
- [ ] Given a player has not completed all required tasks, when they view their hunt progress, then the application does not indicate that the hunt is complete.
- [ ] Given a player has completed a hunt and returns later, when their saved progress is restored, then the application continues to recognize the hunt as completed and displays the completion summary.

## PBI 3: Verify Hunt Readiness and Reliability

### Priority: High

### User Story

As an administrator, I want to know that a hunt is available and can handle player activity reliably, so that players can participate without avoidable interruptions.

### Acceptance Criteria

- [ ] Given a hunt is configured for player access, when its readiness is checked, then the application confirms that its required hunt information and tasks are available.
- [ ] Given a hunt is available, when multiple players attempt to join and interact with it at the same time, then the application continues to respond without unexpected errors or loss of saved progress under the team's agreed load.
- [ ] Given a player joins a hunt and completes a task, when the application saves the player's progress, then the saved progress remains accurate after repeated player interactions.
- [ ] Given readiness and load checks are completed, when a failure or performance issue is identified, then the issue is documented with steps to reproduce it and the affected behavior.

## PBI 4: Observe Hunt Participation and Progress

### Priority: Medium

### User Story

As an administrator, I want to observe player participation and completion progress for a hunt, so that I can understand how the hunt is progressing and identify players who may need assistance.

### Acceptance Criteria

- [ ] Given a hunt has players who joined using valid access codes, when an administrator views its participants, then the application displays the players associated with that hunt.
- [ ] Given a participant has completed some tasks, when an administrator views the participant's progress, then completed and incomplete tasks are distinguishable.
- [ ] Given a participant's progress changes, when an administrator refreshes the view, then the displayed progress reflects the latest saved state.
- [ ] Given a hunt has no participants, when an administrator views its participant list, then the application displays a clear empty state.

## PBI 5: Export Hunt Results

### Priority: Medium

### User Story

As an administrator, I want to export player participation and task completion results for a hunt, so that I can review the results outside BucHunt and maintain a record of the hunt.

### Acceptance Criteria

- [ ] Given an administrator selects an existing hunt, when they request an export, then the application generates a downloadable CSV file containing that hunt's participation results.
- [ ] Given a hunt has participating players, when the results are exported, then the file includes each participant's identifier and the completion status of their assigned tasks.
- [ ] Given a hunt contains participants with incomplete tasks, when the results are exported, then completed and incomplete tasks are accurately distinguished.
- [ ] Given a hunt has no participants, when an administrator requests an export, then the application generates a valid CSV file with column headers and no participant records.
