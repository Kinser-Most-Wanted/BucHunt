# Sprint 7

## Sprint Goal
Enable administrators to manage active hunts and participants while making it easier for players to receive updates and join events.

## PBI 1: Pause and Resume an Active Hunt
**Priority: High**

### User Story
As an administrator, I want to pause and resume an active hunt, so that I can temporarily stop gameplay during an interruption without losing players' progress.

### Acceptance Criteria
- [ ] Given an administrator is managing an active hunt, when they pause the hunt, then the hunt is marked as paused and players cannot submit task answers.
- [ ] Given a hunt is paused, when a participant views the hunt, then the application displays a clear paused message and preserves their completed tasks and saved progress.
- [ ] Given an administrator is managing a paused hunt, when they resume it, then existing participants can continue completing tasks from their saved progress.
- [ ] Given a user who does not administer a hunt attempts to pause or resume it, when the request is processed, then the application denies the change.

## PBI 2: Display Administrator Announcements
**Priority: Medium**

### User Story
As an administrator, I want to post announcements within a hunt, so that participants can see important event updates while they participate.

### Acceptance Criteria
- [ ] Given an administrator is managing a hunt, when they enter and publish an announcement, then the application saves the announcement with that hunt.
- [ ] Given a hunt has a published announcement, when a participant opens or refreshes the hunt, then the announcement is visible within the hunt interface.
- [ ] Given an administrator updates or removes an announcement for their hunt, when a participant next opens or refreshes the hunt, then the displayed announcement reflects the saved change.
- [ ] Given a user does not administer a hunt, when they attempt to publish, edit, or remove its announcements, then the application prevents the change.

## PBI 3: Manage Reported Task Issues
**Priority: Medium**

### User Story
As an administrator, I want to mark reported task issues as resolved or unresolved, so that I can keep track of which player-reported problems still need attention.

### Acceptance Criteria
- [ ] Given an administrator opens the issue inbox for a hunt they manage, when reports are displayed, then each report shows whether it is resolved or unresolved.
- [ ] Given an administrator selects an unresolved report, when they mark it as resolved, then the updated status is saved and displayed.
- [ ] Given an administrator selects a resolved report, when they mark it as unresolved, then the updated status is saved and displayed.
- [ ] Given a user attempts to change the status of an issue report for a hunt they do not manage, when the request is processed, then the application prevents the change.

## PBI 4: Allow Administrators to Remove Hunt Participants
**Priority: Medium**

### User Story
As an administrator, I want to remove individual participants from a hunt I manage, so that I can control who participates without disrupting the rest of the event.

### Acceptance Criteria
- [ ] Given an administrator is viewing the participants of a hunt they manage, when they select a participant, then the application provides an option to remove that participant.
- [ ] Given an administrator selects the removal option, when they confirm the action, then the selected participant is removed from active participation and no longer counts toward the hunt's participant capacity.
- [ ] Given a participant has been removed from a hunt, when they attempt to access its tasks using their previous participation record, then the application prevents further participation.
- [ ] Given an administrator removes a participant, when other players continue participating, then their access and saved progress remain unaffected.

## PBI 5: Share Hunts Using Invitation Links
**Priority: Medium**

### User Story
As an administrator, I want to share a direct invitation link to my hunt, so that participants can access the correct hunt without manually entering an access code.

### Acceptance Criteria
- [ ] Given an administrator is managing a hunt, when they view its sharing options, then the application provides an invitation link associated with that hunt.
- [ ] Given an administrator selects the option to copy the invitation link, when the action succeeds, then the link is copied and ready to share.
- [ ] Given a player opens a valid hunt invitation link, when BucHunt loads, then the application directs them to the associated hunt with its access code automatically populated.
- [ ] Given a player accesses a hunt through an invitation link, when they attempt to join, then the application enforces the existing authentication, participation capacity, and admission rules.
