# Sprint 6

## Sprint Goal

Enable organizations to host personalized hunts, control participation, and support players throughout their events.

\---

## PBI 1: Associate Hunts with an Organization

**Priority:** High

### User Story

As an administrator, I want to associate my hunts with an organization, so that players can identify which organization created the hunt when they participate.

### Acceptance Criteria

* \[ ] Given an administrator is creating a hunt, when they enter an organization name, then the application allows the organization to be associated with that hunt.
* \[ ] Given an administrator saves a hunt with an organization name, when the hunt is retrieved, then the associated organization name is preserved.
* \[ ] Given a player joins a hunt using a valid access code, when the hunt information is displayed, then the associated organization name is clearly visible alongside the hunt details.
* \[ ] Given an administrator edits an existing hunt's organization name, when the changes are saved, then players see the updated organization name when viewing the hunt.

\---

## PBI 2: Allow Administrators to Start a Hunt

**Priority:** High

### User Story

As an administrator, I want players to wait until I start the hunt, so that everyone can begin participating when my organization is ready.

### Acceptance Criteria

* \[ ] Given an administrator has created a hunt that has not started, when a player joins using a valid access code, then the player is admitted to a waiting lobby rather than being allowed to complete tasks.
* \[ ] Given a player is waiting for a hunt to begin, when they view the hunt, then the application displays a message indicating that the administrator has not started the hunt.
* \[ ] Given an administrator starts the hunt, when an existing participant refreshes or reopens the hunt, then the player can access the available tasks.
* \[ ] Given a hunt has not started, when a player attempts to access or submit answers for hunt tasks, then the application prevents task participation until the administrator starts the hunt.

\---

## PBI 3: Customize Hunt Appearance with Predefined Themes

**Priority:** Medium

### User Story

As an administrator, I want to select a predefined color theme for my hunt, so that I can personalize its appearance to reflect my organization's identity without having to design it myself.

### Acceptance Criteria

* \[ ] Given an administrator is creating or editing a hunt, when they view the appearance settings, then the application displays a selection of predefined color themes.
* \[ ] Given an administrator selects a predefined theme, when they save the hunt configuration, then the selected theme is saved and associated with that hunt.
* \[ ] Given a player joins a hunt using a valid access code, when they view the hunt interface, then the application displays the hunt's selected color theme consistently across its primary visual elements.
* \[ ] Given an administrator has not selected a theme, when a player views the hunt, then the application displays the default BucHunt theme.

\---

## PBI 4: Report Hunt Task Issues to the Hunt Administrator

**Priority:** Medium

### User Story

As a player, I want to report issues with hunt tasks directly to the administrator responsible for the hunt, so that problems can be identified and addressed by the person managing my hunt.

### Acceptance Criteria

* \[ ] Given a player is viewing a hunt task, when they select the option to report an issue, then the application allows them to enter and submit a description of the problem.
* \[ ] Given a player submits a task issue report, when the submission is successful, then the report is saved with the associated hunt and task and made available to that hunt's administrator.
* \[ ] Given an administrator opens the issue inbox for a hunt they manage, when reports have been submitted, then the application displays the reported issues along with their associated tasks and descriptions.
* \[ ] Given an administrator attempts to view issue reports for a hunt they do not manage, when the request is processed, then the application prevents access to those reports.

\---

## PBI 5: Control Hunt Participation and Capacity

**Priority:** High

### User Story

As an administrator, I want to limit the number of players who can join my hunt and close participation when everyone is ready, so that only intended participants can join while existing players continue uninterrupted.

### Acceptance Criteria

* \[ ] Given an administrator is configuring a hunt, when they set a maximum number of participants, then the application saves that limit with the hunt.
* \[ ] Given a hunt has reached its maximum participant capacity or an administrator has closed participation, when a new player attempts to join using a valid access code, then the application prevents entry and displays a message explaining why joining is unavailable.
* \[ ] Given an administrator is managing an existing hunt, when they manually close or reopen participation, then the application updates whether new players can join while continuing to enforce the maximum participant limit.
* \[ ] Given a player successfully joined a hunt before participation was closed, when they continue playing or return using their existing participation record, then they retain access to their tasks and saved progress without being treated as a new participant.

\---

## Sprint 6 Summary

|PBI|Title|Priority|
|-|-|-|
|1|Associate Hunts with an Organization|High|
|2|Allow Administrators to Start a Hunt|High|
|3|Customize Hunt Appearance with Predefined Themes|Medium|
|4|Report Hunt Task Issues to the Hunt Administrator|Medium|
|5|Control Hunt Participation and Capacity|High|

## Implementation Considerations

These PBIs are designed for BucHunt's existing architecture, without introducing a database or a full organization-account management system.

For parallel AI-assisted development, the team should establish shared interfaces for hunt configuration and participation status before implementation. PBI 2 controls when gameplay begins, while PBI 5 controls whether new players may join; these must remain separate behaviors.

The team should also verify that concurrent joins cannot exceed the participant limit and that issue reports are accessible only to the appropriate hunt administrator.

This Sprint 6 proposal is for the Scrum Team to refine and commit to during Sprint Planning.

