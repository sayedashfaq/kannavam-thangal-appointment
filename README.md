# Kannavam Thangal — WhatsApp Appointment & Token Management System

A production-ready appointment and token system that runs entirely over WhatsApp. Visitors book by chatting with the business number, and the administrator runs the whole system with WhatsApp commands. No website or mobile app is required.

## Features

- **Visitor booking flow** — collects name, place and mobile number over WhatsApp
- **Daily token numbers** — issued as `T001`, `T002`, … and reset every consultation day
- **Configurable token limits** — per consultation day, adjustable over WhatsApp
- **Reporting times** — spread across the morning and afternoon sessions
- **Admin commands** — open/close booking, leave, status, listings, cancellations, schedule edits
- **Automatic notifications** — admin is alerted on every confirmed booking
- **Timezone-correct** — all day and token logic uses the consultation timezone, not the server clock
- **Safe against retries** — duplicate webhook deliveries and repeat bookings are rejected
- **Structured logging** — incoming and outgoing messages, admin commands, bookings and errors

## Tech Stack

Node.js · Express · MongoDB (Mongoose) · WhatsApp Cloud API (Meta) · Winston

## Consultation Schedule

| Day | Location | Morning | Afternoon | Default limit |
|-----|----------|---------|-----------|---------------|
| Tuesday | Jalaliya Manzil Adhur | 10:00–13:00 | 14:00–16:00 | 30 |
| Wednesday | Jalaliya Manzil Adhur | 10:00–13:00 | 14:00–16:00 | 25 |
| Saturday | Jalaliya Manzil Bendichal | 10:00–13:00 | 14:00–16:00 | 35 |

Bookings are accepted only while an active schedule exists for the current day, so adding or pausing a day needs no code change.

## Setup

### 1. Requirements

- Node.js 18 or newer
- MongoDB (local or Atlas)
- Meta WhatsApp Business account with Cloud API access

### 2. Install

```bash
cd appointment-system
npm install
```

### 3. Configure

Copy `.env.example` to `.env` and fill in the values.

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB connection string |
| `TIMEZONE` | Timezone for consultation days and token resets (default `Asia/Kolkata`) |
| `WHATSAPP_TOKEN` | Access token from the Meta dashboard |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone number ID from the Meta dashboard |
| `WHATSAPP_VERIFY_TOKEN` | Any secret string, reused when registering the webhook |
| `WHATSAPP_APP_SECRET` | Optional. When set, webhook signatures are verified |
| `ADMIN_PHONE` | Admin WhatsApp number with country code and no `+` |
| `DYNAMIC_REPORTING_TIME` | `true` spreads reporting times, `false` asks everyone to arrive at the session start |

The server refuses to start if a required variable is missing or still holds a placeholder value.

### 4. Seed the default schedules

```bash
npm run seed
```

Re-running the seed is safe. It only fills in what is missing and never overwrites limits or locations the admin has already changed.

### 5. Start

```bash
npm run dev    # development, with reload
npm start      # production
```

### 6. Register the webhook

Expose the port over HTTPS, for example with ngrok:

```bash
ngrok http 3000
```

Then in **Meta Developer Dashboard → WhatsApp → Configuration**:

| Field | Value |
|-------|-------|
| Callback URL | `https://your-domain.com/webhook` |
| Verify token | the value of `WHATSAPP_VERIFY_TOKEN` |
| Webhook fields | subscribe to `messages` |

## Verifying the installation

```bash
npm run verify
```

This exercises the booking rules end to end with WhatsApp delivery stubbed out: token sequencing, cancellation handling, token limits, leave, closed booking, non-consultation days, duplicate bookings, phone validation, reporting-time distribution and every admin command. Test data is created under reserved numbers and removed afterwards, and all settings are restored.

If the configured database is unreachable, the suite falls back to a temporary in-memory MongoDB. Force that mode with:

```bash
VERIFY_MEMORY=1 npm run verify
```

## Visitor Flow

1. Visitor sends **Hi**, **Hello** or **Assalamu Alaikum**
2. System immediately shows whether booking is open, with the **exact consultation date** (e.g. *Tuesday, 28 Jul 2026 (tomorrow)*), venue and tokens left — or explains when the next day opens
3. If booking is open, system asks for full name → place → mobile number → **family members**
4. Visitor receives the token number, dated consultation, member count, location and reporting time (10 minutes per token); the admin is notified

Tokens open from the **day before** each consultation day until **9:00 AM** on the consultation morning (Asia/Kolkata). Example: Tuesday tokens can be booked all Monday and on Tuesday until 9:00 AM. If the nearest day is on leave or full, the system moves visitors to the next available day (including early-opening the next day when leave blocks the current window).

## Admin Commands

Accepted only from the number in `ADMIN_PHONE`. Messages from any other number are treated as visitor messages.

| Command | Description |
|---------|-------------|
| `menu` | Show the menu |
| `close` | Pause **all** new bookings temporarily |
| `open` | Allow bookings again after `close` |
| `leave tuesday` | Put **next Tuesday** on leave (Wednesday/Saturday stay open) |
| `leave saturday emergency` | Day leave with reason; cancels that day's bookings and WhatsApps every visitor |
| `open tuesday` / `resume tuesday` | Change of mind — open that Tuesday again |
| `open saturday` | Open that Saturday again |
| `status` | Active consultation + day leaves |
| `today` / `list` | Bookings for the active open day |
| `list tuesday` | Bookings for next Tuesday |
| `upcoming` | Next days with dates, leave flags, and token windows |
| `find <phone>` | Booking details for a visitor |
| `cancel <token>` | Cancel a booking, e.g. `cancel T005` |
| `change adhur` / `location adhur` | Set active day's venue to Jalaliya Manzil Adhur |
| `change bendichal` | Set active day's venue to Jalaliya Manzil Bendichal |
| `change adhur tuesday` | Set Tuesday to Adhur |
| `change bendichal saturday` | Set Saturday to Bendichal |
| `change time wednesday 10am to 12pm` | Set Wednesday morning to 10:00 AM–12:00 PM only (no afternoon) |
| `change time wednesday 10am to 12pm 1pm to 4pm` | Set Wednesday morning + afternoon hours |
| `change time 10am to 1pm 2pm to 4pm` | Set hours for the active consultation day |
| `schedules` | Show configured weekdays |
| `schedule <day> "<location>" <mStart> <mEnd> <aStart> <aEnd> <limit>` | Update a day |
| `help` | Full command list |

**Leave vs close:** `leave tuesday` only blocks that dated consultation. `close` pauses everything until `open`.

Example schedule update:

```
schedule Tuesday "Jalaliya Manzil Adhur" 10:00 13:00 14:00 16:00 30
```

## Token Rules

- Numbering restarts at `T001` on every consultation day
- Numbers come from an atomic per-day counter, so simultaneous bookings can never share a token
- Cancelling a single booking frees a slot against the limit but does not reuse that token number
- If a whole day is cancelled by `leave <day>` and later reopened with `open <day>`, tokens and reporting times restart from `T001` / morning start
- A unique index on day plus token number for active (`BOOKED`) rows enforces this at the database level

## Project Structure

```
appointment-system/
├── config/          env loading, database connection, seed data
├── constants/        message templates, statuses, steps, weekdays
├── controllers/      webhook verification and message intake
├── routes/           Express routes
├── services/         booking, admin, conversation, schedule, settings, WhatsApp
├── models/           Booking, Schedule, Settings, Conversation, Counter
├── middlewares/      error handling, webhook signature verification
├── helpers/          token, time, phone and validation helpers
├── utils/            logger, processed-message cache
├── scripts/          verification suite
├── logs/             rotating application logs
└── server.js         entry point
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/webhook` | Webhook verification handshake |
| POST | `/webhook` | Incoming WhatsApp messages |
| GET | `/health` | Health check |

## Error Handling

The visitor receives a clear reply for each case: booking closed, consultant on leave (with reason when given), invalid mobile number, duplicate booking for the day, non-consultation day, and token limit reached. Unknown admin commands return the command hint.

## Extending

The structure supports adding these without restructuring:

- Multiple consultants — add a consultant reference to `Schedule` and `Booking`
- More locations — location already lives on the schedule
- Multiple admins — replace the single `ADMIN_PHONE` check in `adminService.isAdmin`
- Holiday calendar — deactivate a schedule or add date-specific overrides
- Interactive buttons — the webhook already reads button and list replies as text
- Broadcasts and reminders — `whatsappService` and the stored `whatsappNumber` support outbound sends
- React admin dashboard — the services are transport-agnostic and can sit behind REST controllers

## Notes on the Meta test number

A Meta test number can only message recipients that have been added to the allowed list in the dashboard under **WhatsApp → API Setup**. Add the admin number and any number used for testing. Production numbers have no such restriction.

## License

ISC
