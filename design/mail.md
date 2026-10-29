# Player Mail

In-game messaging between player characters. Players can send, receive, and report mail from character profile pages and the Notifications page.

## Sending Mail

- **Access**: Click "Send Mail" on any character's profile page, which opens the Mail Composer Modal
- **Fields**: Subject (max 80 chars), Body (max 1000 chars)
- **Rate limit**: 1 message per minute per sender
- **Requirement**: Both sender and recipient must have characters

## Inbox & Sent Box

The Mail tab on the Notifications page (`/notifications`) provides two views:

- **Inbox**: All received mail, newest first. Unread messages highlighted. Expanding a message auto-marks it as read.
- **Sent**: All sent mail, newest first. Senders can delete their copy independently.

Both views are paginated via the API.

## Unread Count

Unread mail count is returned by both `/api/client-nav` and `/api/auth/me` as `unreadMailCount`. The navbar badge combines unread notifications + unread mail into a single count.

## Deletion

Mail uses **dual-sided soft-delete**:

- Recipient deletes → sets `deletedByRecipient: true`; mail disappears from their inbox but remains in sender's sent box
- Sender deletes → sets `deletedBySender: true`; mail disappears from their sent box but remains in recipient's inbox
- When both flags are true, the document can be hard-deleted (currently retained)

## Reporting

Any received message can be reported for abuse. Reports go to the admin mail reports queue.

- **Player action**: "Report" button on expanded inbox messages
- **Creates**: `PlayerMailReport` document with status `"pending"`
- **One report per mail**: Duplicate reports on the same message are rejected

## Admin Mail Reports

Admin > Support > Mail Reports tab. Filterable by status: pending, dismissed, actioned.

Each report shows the full message body, sender/recipient links, and four actions:

| Action      | Effect                                                       |
| ----------- | ------------------------------------------------------------ |
| **Dismiss** | Sets status to `"dismissed"`; no player impact               |
| **Delete**  | Removes the mail document; sets status to `"actioned"`       |
| **Warn**    | Sends a system notification to the sender; sets `"actioned"` |
| **Ban**     | Bans the sender's user account; sets `"actioned"`            |

All actions accept an optional admin note (max 500 chars).

## Shareholder Address

CEOs can broadcast a message to all current shareholders of their corporation.

- **Access**: Corporation page > CEO Office > Admin subtab
- **Cooldown**: 12 hours per corporation (enforced via `lastShareholderAddressAt` on the `Corporation` document)
- **Delivery**: Sent as system notifications (not mail) to each shareholder's userId
- **Composer**: Uses the same Mail Composer Modal in `shareholder-address` mode

## Database

### `playerMail` collection

| Field                       | Type       | Description                   |
| --------------------------- | ---------- | ----------------------------- |
| `_id`                       | `ObjectId` | Document ID                   |
| `fromCharacterId`           | `ObjectId` | Sender character              |
| `fromCharacterName`         | `string`   | Sender display name           |
| `fromCharacterSequentialId` | `number`   | Sender sequential ID          |
| `toUserId`                  | `ObjectId` | Recipient user                |
| `toCharacterId`             | `ObjectId` | Recipient character           |
| `toCharacterName`           | `string`   | Recipient display name        |
| `toCharacterSequentialId`   | `number`   | Recipient sequential ID       |
| `subject`                   | `string`   | Subject line (max 80 chars)   |
| `body`                      | `string`   | Message body (max 1000 chars) |
| `read`                      | `boolean`  | Has recipient read it         |
| `deletedByRecipient`        | `boolean`  | Recipient soft-delete flag    |
| `deletedBySender`           | `boolean`  | Sender soft-delete flag       |
| `createdAt`                 | `Date`     | Send timestamp                |

### `playerMailReports` collection

| Field               | Type        | Description                 |
| ------------------- | ----------- | --------------------------- | ------------- | ------------ |
| `_id`               | `ObjectId`  | Document ID                 |
| `mailId`            | `ObjectId`  | Reference to reported mail  |
| `reportedByUserId`  | `ObjectId`  | User who filed the report   |
| `status`            | `string`    | `"pending"`                 | `"dismissed"` | `"actioned"` |
| `adminNote`         | `string?`   | Admin notes (max 500 chars) |
| `reviewedAt`        | `Date?`     | When admin reviewed         |
| `reviewedByAdminId` | `ObjectId?` | Admin who reviewed          |
| `createdAt`         | `Date`      | Report timestamp            |

## API Routes

| Method   | Path                           | Description                            |
| -------- | ------------------------------ | -------------------------------------- |
| `GET`    | `/api/mail`                    | Inbox (paginated, excludes deleted)    |
| `POST`   | `/api/mail`                    | Send mail (rate-limited 1/min)         |
| `PATCH`  | `/api/mail/[id]`               | Mark as read                           |
| `DELETE` | `/api/mail/[id]`               | Soft-delete from inbox                 |
| `GET`    | `/api/mail/sent`               | Sent box (paginated, excludes deleted) |
| `DELETE` | `/api/mail/sent/[id]`          | Soft-delete from sent box              |
| `POST`   | `/api/mail/[id]/report`        | Report a message for abuse             |
| `GET`    | `/api/admin/mail-reports`      | List reports (filterable by status)    |
| `PATCH`  | `/api/admin/mail-reports/[id]` | Admin action (dismiss/delete/warn/ban) |

## Related

- [Getting Started](./getting-started.md) - Overview of player features
- [Corporations](./corporations.md) - Shareholder Address feature
- [Core Systems](./core-systems.md) - News system (similar player-content system)
