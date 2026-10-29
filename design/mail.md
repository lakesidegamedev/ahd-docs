# Player Mail

In-game messaging between player characters. Players can send, receive, and report mail from character profile pages and the Notifications page. Game systems (forex fills, loan decisions) also deliver system mail into the same inbox.

Player guide: [Mail](https://www.ahousedividedgame.com/wiki/mail)

## Rules

## Sending Mail

- **Access**: Click "Send Mail" on any character's profile page, which opens the Mail Composer Modal
- **Fields**: Subject 1 to 80 chars, body 1 to 1000 chars (`sendMailSchema` in `src/app/api/mail/route.ts`)
- **Rate limit**: 1 message per 60 seconds per sending character, in-memory limiter keyed `api/mail:<characterId>` (`src/app/api/mail/route.ts`). It exists to stop flooding.
- **Requirement**: Both sender and recipient must have characters (`requireAuthWithCharacter`; the recipient is looked up by `toCharacterId`)
- **Refused sends** (`sendPlayerMail` in `src/lib/mail/commands/playerMail.ts`): mailing yourself (400), subject or body that trips the slur filter `containsSlur` (400), unknown recipient (404), and a recipient who is banned or has blocked the sender (400, with the same message in both cases so a blocked sender is not told)

## Inbox & Sent Box

The Mail tab on the Notifications page (`/notifications`) provides two views:

- **Inbox**: All received mail, newest first. Unread messages highlighted. Expanding a message auto-marks it as read.
- **Sent**: All sent mail, newest first. Senders can delete their copy independently.

Both views are paginated via the API: default 20 per page, maximum 50 (`src/app/api/mail/route.ts`). Mail from a sender the recipient has blocked is hidden from the inbox while the block lasts (`blockedByRecipient` flag, set and cleared by `blockPlayer` and `unblockPlayer` in `src/lib/safety/playerSafety.ts`; a player can block up to `MAX_BLOCKED_USERS` = 500 users).

System mail (`sendSystemMail` in `src/lib/mail/systemMail.ts`) has no sender character, defaults the sender name to "Forex Market", and cannot be replied to or deleted from a sent box because it has none.

## Unread Count

Unread mail count is returned by both `/api/client-nav` and `/api/auth/me` as `unreadMailCount`. The navbar badge combines unread notifications + unread mail into a single count.

## Deletion

Mail uses **dual-sided soft-delete**:

- Recipient deletes → sets `deletedByRecipient: true`; mail disappears from their inbox but remains in sender's sent box
- Sender deletes → sets `deletedBySender: true`; mail disappears from their sent box but remains in recipient's inbox
- When the second side deletes, the document is hard-deleted at once (`deleteReceivedMail` and `deleteSentMail` in `src/lib/mail/commands/playerMail.ts`). An admin "Delete" action hard-deletes immediately regardless of flags.

## Reporting

Any received message that the recipient has not deleted can be reported for abuse. Reports go to the staff mail reports queue.

- **Player action**: "Report" button on expanded inbox messages
- **Creates**: `PlayerMailReport` document with status `"pending"` and a `mailSnapshot` copy of the message, so the report survives if both sides later delete the mail or a world reset drops `playerMail`
- **One report per mail**: Duplicate reports on the same message are rejected with 409
- **Rate limit**: 10 reports per minute per user (`src/app/api/mail/[id]/report/route.ts`)
- **Notification**: every admin and moderator receives a "New Mail Report" system notification
- **No block or mute from mail alone**: stopping a sender is done with the player block list (see above), which also hides existing mail from that sender

## Admin Mail Reports

Mail Reports tab in the admin or moderator panel (routes use `requireModerator`, so moderators and admins both have access). Filterable by status: pending, dismissed, actioned. The detail view loads the full conversation thread (`src/lib/mail/queries/mailReportDetail.ts`).

Each report shows the full message body, sender/recipient links, and four actions:

| Action      | Effect                                                       |
| ----------- | ------------------------------------------------------------ |
| **Dismiss** | Sets status to `"dismissed"`; no player impact               |
| **Delete**  | Hard-deletes the mail document; sets status to `"actioned"`  |
| **Warn**    | Sends a system notification to the sender; sets `"actioned"` |
| **Ban**     | Bans the sender's user account; sets `"actioned"`            |

All actions accept an optional admin note (max 500 chars).

## Shareholder Address

CEOs can broadcast a message to all current shareholders of their corporation.

- **Access**: Corporation page > CEO Office > Admin subtab
- **Cooldown**: 12 hours per corporation (enforced via `lastShareholderAddressAt` on the `Corporation` document)
- **Limits**: body 1 to 1000 chars; only the corporation's CEO may send it (`src/app/api/corporations/[id]/shareholder-address/route.ts`)
- **Delivery**: Sent as system notifications (not mail) to each shareholder with shares above zero, so it never appears in the Mail inbox and cannot be reported through the mail flow. The cooldown starts when the request is accepted, even if there are no shareholders to notify.
- **Composer**: Uses the same Mail Composer Modal in `shareholder-address` mode

## Timing

Mail is not part of the turn processor. Everything is request driven: sending, reading, deleting and reporting run when the player acts. The only turn-time writers are system mail senders in `src/lib/turn/forexTurn.ts` and `src/lib/turn/forexLimitOrders.ts` (forex fills) and `src/lib/banking/loanApproval.ts`, which insert through `sendSystemMail` during their own phase. Unread counts are computed on each `/api/client-nav` and `/api/auth/me` call, not cached.

## Edge cases and limits

- **No block inside mail, but a global block list exists.** Blocking a user hides their mail and rejects new sends from them.
- **Offline recipients.** Mail is stored until read; there is no expiry and no retention limit in code.
- **Reported mail.** The report holds a snapshot of the reported message, and the detail view loads the surrounding thread, so staff see context.
- **Banned recipient.** Sending to a banned user is refused.
- **Mail and world resets.** `playerMail` is world state and is dropped on reset; report snapshots outlive it.
- **System mail.** No sender character, so no sent-box copy and no reply target.

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
| `mailSnapshot`      | `object?`   | Copy of the message at report time |
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

## Connections

- **Driven by:** forex fills and loan decisions (`sendSystemMail` callers in `src/lib/turn/` and `src/lib/banking/`), and the player block list (`src/lib/safety/playerSafety.ts`).
- **Affects:** the navbar unread badge (`unreadMailCount` in `src/app/api/client-nav/route.ts`) and the moderation queue and ban flow (`src/app/api/admin/mail-reports/[id]/route.ts`).

## Related

- [Getting Started](./getting-started.md) - Overview of player features
- [Corporations](./corporations.md) - Shareholder Address feature
- [Core Systems](./core-systems.md) - News system (similar player-content system)

Last checked: 2026-10-29, version 1.18.0
