# Requirements Document

## Introduction

PLANPAL is an event-scoped, Telegram-based group expense coordination system that records shared agreements around money using consensus, not transactions. The system focuses on human agreement and social fairness rather than payment execution, operating as a neutral mediator for group financial decisions within existing Telegram groups.

**Current Implementation Status**: PLANPAL has been implemented as a TypeScript full-stack application with React frontend, Express.js backend, PostgreSQL database, and Telegram bot integration. This requirements document captures both existing functionality and identifies areas for enhancement.

## Glossary

- **Event**: A specific occasion or gathering for which expenses are tracked and coordinated
- **Event_Creator**: The user who creates an event and has administrative privileges
- **Group_Member**: A participant in a Telegram group who can participate in expense tracking
- **Expense_Proposal**: A suggested expense that requires group consensus before being recorded
- **Consensus**: Majority agreement with no active disagreements on an expense proposal
- **Payment_Acknowledgment**: A claim by one user that they have paid another user externally
- **Payment_Confirmation**: Verification by the recipient that a payment was received
- **Settlement_Algorithm**: The system that computes net balances and minimal transfers
- **Web_App**: The React-based web application interface used by event creators
- **Telegram_Bot**: The bot that operates within Telegram groups to facilitate expense coordination
- **Backend_System**: The Express.js server and PostgreSQL database infrastructure that stores all data
- **Event_Code**: A unique identifier that links web app events to Telegram groups
- **Split_Among**: Array of usernames defining who should share an expense cost

## Requirements

### Requirement 1: User Authentication and Event Management

**User Story:** As an event creator, I want to authenticate and manage events through a web application, so that I can coordinate group expenses for specific occasions.

#### Acceptance Criteria

1. WHEN a user visits the authentication page, THE Web_App SHALL provide username/password authentication and redirect authenticated users to dashboard
2. WHEN a user successfully authenticates, THE Web_App SHALL create a secure session and redirect them to a dashboard showing their event list
3. WHEN an authenticated user creates an event, THE Web_App SHALL generate a unique Event_Code and store event details in the database
4. WHEN an Event_Creator views their dashboard, THE Web_App SHALL display all events they have created with current status and basic statistics
5. WHEN an Event_Creator views event details, THE Web_App SHALL display expenses, payments, and settlement calculations for that event
6. THE Web_App SHALL restrict event creation and management to authenticated users only
7. WHEN an event is linked to a Telegram group, THE Web_App SHALL prevent editing or deletion of that event

### Requirement 2: Telegram Bot Integration and Group Linking

**User Story:** As a group member, I want to connect the PLANPAL bot to our existing Telegram group, so that we can coordinate expenses without leaving our conversation.

#### Acceptance Criteria

1. WHEN a user sends `/start <eventcode>` in private chat, THE Telegram_Bot SHALL link the user with the specified event if the code is valid
2. WHEN an Event_Creator sends `/startevent <eventcode>` in a group chat, THE Telegram_Bot SHALL activate expense tracking for that event in the group and update the event status to ACTIVE
3. WHEN the bot receives commands in an unlinked group, THE Telegram_Bot SHALL respond with appropriate error messages
4. WHEN an invalid Event_Code is provided, THE Telegram_Bot SHALL return a descriptive error message and reject the operation
5. THE Telegram_Bot SHALL only allow Event_Creators to start events in groups
6. WHEN a group is successfully linked, THE Telegram_Bot SHALL store the Telegram group ID and associate it with the event

### Requirement 3: Expense Proposal and Consensus Management

**User Story:** As a group member, I want to propose expenses and participate in group consensus, so that all financial decisions are agreed upon collectively.

#### Acceptance Criteria

1. WHEN a Group_Member sends `/addexpense <amount> <description> @mentions`, THE Telegram_Bot SHALL create an Expense_Proposal with the specified amount, description, and participants
2. WHEN no mentions are provided in an expense proposal, THE Telegram_Bot SHALL automatically confirm the expense with the payer as the only participant
3. WHEN mentions are provided in an expense proposal, THE Telegram_Bot SHALL create a PENDING expense requiring approval from mentioned users
4. WHEN an expense involves multiple participants, THE Telegram_Bot SHALL split the cost equally among all mentioned users plus the payer
5. WHEN processing expense commands, THE Telegram_Bot SHALL validate amount format and reject invalid inputs with helpful error messages
6. THE Telegram_Bot SHALL extract mentions from message entities and parse description text correctly
7. WHEN an expense is created, THE Telegram_Bot SHALL store it with proper status (CONFIRMED for single-user, PENDING for multi-user)

### Requirement 4: Payment Acknowledgment and Confirmation System

**User Story:** As a group member, I want to record external payments made between group members, so that the system can track who has settled their obligations.

#### Acceptance Criteria

1. WHEN a Group_Member sends `/paid @user <amount>`, THE Telegram_Bot SHALL create a Payment_Acknowledgment in PENDING status requiring confirmation
2. WHEN the recipient sends `/confirmpayment @user <amount>`, THE Telegram_Bot SHALL find the matching pending payment and update its status to CONFIRMED
3. WHEN a Payment_Acknowledgment is created, THE Telegram_Bot SHALL notify the recipient with instructions for confirmation
4. WHEN payment amounts don't match between acknowledgment and confirmation, THE Telegram_Bot SHALL reject the confirmation with an error message
5. THE Telegram_Bot SHALL only allow users to acknowledge payments they claim to have made and confirm payments they claim to have received
6. WHEN a payment is confirmed, THE Telegram_Bot SHALL update the payment status and notify both parties
7. THE Telegram_Bot SHALL store payment amounts in cents to avoid floating-point precision issues

### Requirement 5: Settlement Calculation and Balance Management

**User Story:** As a group member, I want the system to calculate who owes whom and by how much, so that we can settle expenses with minimal transfers.

#### Acceptance Criteria

1. WHEN expenses are confirmed, THE Settlement_Algorithm SHALL split costs equally among designated participants in the splitAmong array
2. WHEN payments are confirmed, THE Settlement_Algorithm SHALL update individual net balances by adjusting debtor and creditor amounts
3. WHEN calculating final settlements, THE Settlement_Algorithm SHALL compute net balances for all participants across all confirmed expenses and payments
4. WHEN generating settlement recommendations, THE Settlement_Algorithm SHALL use a greedy algorithm to minimize the number of required transfers
5. THE Settlement_Algorithm SHALL ensure that all debts and credits balance to zero across the entire group (sum of all balances equals zero)
6. WHEN displaying settlement information, THE System SHALL show pending debts with specific payer-payee pairs and amounts
7. THE Settlement_Algorithm SHALL handle edge cases where users have zero or minimal balances (less than 1 cent)

### Requirement 6: Summary and Reporting System

**User Story:** As an event creator and group member, I want to view expense summaries and settlement status, so that I can track the financial state of our event.

#### Acceptance Criteria

1. WHEN a user requests `/summary`, THE Telegram_Bot SHALL provide total confirmed expenses and basic event statistics
2. WHEN a user requests `/report`, THE Telegram_Bot SHALL provide detailed breakdown including confirmed expenses, settlements, and pending debts
3. WHEN displaying summaries, THE Telegram_Bot SHALL show confirmed expenses with payer information and timestamps
4. WHEN displaying reports, THE Telegram_Bot SHALL calculate and show net balances and optimal settlement recommendations
5. THE Telegram_Bot SHALL format all monetary amounts consistently in INR with proper decimal places
6. WHEN generating settlement recommendations, THE Telegram_Bot SHALL use a greedy algorithm to minimize transfer count
7. THE Telegram_Bot SHALL escape special characters properly for Telegram MarkdownV2 formatting

### Requirement 7: Event Lifecycle Management

**User Story:** As an event creator, I want to manage the complete lifecycle of an event, so that I can control when expense tracking begins and ends.

#### Acceptance Criteria

1. WHEN an event is created, THE System SHALL set its status to CREATED and generate a unique event code
2. WHEN a Telegram group is linked to an event, THE System SHALL update the event status to ACTIVE
3. WHEN an Event_Creator sends `/closeevent`, THE Telegram_Bot SHALL verify all expenses and payments are resolved before closing
4. WHEN closing an event with pending items, THE Telegram_Bot SHALL reject the closure and list pending items
5. WHEN an event is successfully closed, THE Telegram_Bot SHALL update the event status to CLOSED and prevent further modifications
6. THE System SHALL prevent editing or deletion of events that have been linked to Telegram groups
7. WHEN an event is closed, THE Telegram_Bot SHALL provide a final summary and settlement report

### Requirement 8: Data Persistence and System Architecture

**User Story:** As a system administrator, I want reliable data storage and system architecture, so that user data is preserved and the system operates efficiently.

#### Acceptance Criteria

1. WHEN users, events, expenses, or payments are created, THE Backend_System SHALL persist all data reliably to the PostgreSQL database using Drizzle ORM
2. WHEN the system processes transactions, THE Backend_System SHALL maintain ACID properties and data consistency across all operations
3. WHEN integrating Web_App and Telegram_Bot functionality, THE Backend_System SHALL provide unified data access through the storage layer
4. WHEN handling concurrent operations, THE Backend_System SHALL prevent race conditions and maintain transaction integrity
5. THE Backend_System SHALL store monetary amounts as integers (cents) to avoid floating-point precision issues
6. WHEN storing user data, THE Backend_System SHALL maintain proper foreign key relationships and referential integrity
7. THE Backend_System SHALL provide session management for web authentication using PostgreSQL session store

### Requirement 9: Security and Access Control

**User Story:** As a user, I want my financial data to be secure and access-controlled, so that only authorized participants can view and modify expense information.

#### Acceptance Criteria

1. WHEN authenticating users, THE Web_App SHALL validate credentials securely using Passport.js and maintain secure sessions
2. WHEN processing Telegram commands, THE Telegram_Bot SHALL verify user authorization for each operation based on event participation
3. WHEN storing sensitive data, THE Backend_System SHALL use secure password hashing and protect against common vulnerabilities
4. WHEN users access event data, THE Backend_System SHALL enforce role-based permissions ensuring users can only access their own events
5. THE Backend_System SHALL validate all input data using Zod schemas to prevent injection attacks and data corruption
6. WHEN handling API requests, THE System SHALL require authentication for all protected endpoints
7. THE System SHALL log security-relevant events while protecting user privacy and sensitive financial information

### Requirement 10: OCR Invoice Processing with Manual Fallback

**User Story:** As a group member, I want to upload invoice images and automatically extract expense details, with the option to enter details manually if the image is unclear, so that I can quickly add expenses regardless of image quality.

#### Acceptance Criteria

1. WHEN a user uploads an image with `/addexpense` command and mentions, THE Telegram_Bot SHALL process the image using OCR to extract expense details
2. WHEN OCR processing is successful, THE System SHALL extract amount, description, and merchant information from the invoice text
3. WHEN expense details are extracted, THE System SHALL create an expense with the extracted amount and description, split among mentioned users plus the payer
4. WHEN OCR fails to extract a valid amount, THE System SHALL prompt the user to provide the amount manually while using extracted description
5. WHEN OCR confidence is below threshold or image is unclear, THE System SHALL ask the user to enter expense details manually and confirm participant mentions
6. WHEN manual entry is requested, THE System SHALL provide an interactive prompt asking for amount, description, and confirmation of mentioned participants
7. WHEN user provides manual details, THE System SHALL create the expense using manual input and preserve the original mentioned participants from the image command
8. THE System SHALL use Tesseract.js for 100% free OCR processing without external API dependencies or usage limits
9. WHEN processing images, THE System SHALL handle common invoice formats and currency symbols (₹, INR, Rs.) with pattern matching
10. THE System SHALL provide feedback to users about OCR processing status and extracted details for confirmation before creating the expense
11. WHEN image quality is poor, THE System SHALL provide helpful error messages and automatically trigger manual entry workflow
12. THE System SHALL maintain conversation state to handle multi-step manual entry process for unclear invoice images