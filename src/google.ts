// Calendar and Tasks data from every connected Google account, merged.
// All network calls go through the Rust side, which adds the sign-in token.
import { googleApi, googleStatus, GoogleStatus } from "./native";

const CAL = "https://www.googleapis.com/calendar/v3";
const TASKS = "https://tasks.googleapis.com/tasks/v1";

export interface CalEvent {
  account: string;
  id: string;
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  meet?: string;
  location?: string;
  link?: string;
}

export interface Task {
  account: string;
  list: string;
  id: string;
  title: string;
  due?: Date;
  notes?: string;
}

export interface AccountError { account: string; message: string }

/** "Work" for a company address, "Personal" for Gmail. */
export function accountLabel(email: string): string {
  return /@(gmail|googlemail)\.com$/i.test(email) ? "Personal" : "Work";
}

/** Each account gets a stable colour: first blue, then green, purple, orange. */
export function accountColor(email: string, all: string[]): string {
  const colors = ["blue", "green", "purple", "orange", "teal"];
  return `var(--${colors[Math.max(0, all.indexOf(email)) % colors.length]})`;
}

export const status = (): Promise<GoogleStatus> => googleStatus();

/** Events from now until `days` ahead, from each account's main calendar. */
export async function upcoming(accounts: string[], days = 7): Promise<{ events: CalEvent[]; errors: AccountError[] }> {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const until = new Date(startOfToday.getTime() + days * 86_400_000);
  const errors: AccountError[] = [];
  const lists = await Promise.all(
    accounts.map(async (account) => {
      const q = new URLSearchParams({
        timeMin: startOfToday.toISOString(),
        timeMax: until.toISOString(),
        singleEvents: "true",
        orderBy: "startTime",
        maxResults: "60",
      });
      try {
        const r = await googleApi<any>(account, "GET", `${CAL}/calendars/primary/events?${q}`);
        return (r.items ?? [])
          .filter((e: any) => e.status !== "cancelled")
          .filter((e: any) => !(e.attendees ?? []).some((a: any) => a.self && a.responseStatus === "declined"))
          .map((e: any): CalEvent => {
            const allDay = !e.start?.dateTime;
            const start = allDay ? new Date(`${e.start.date}T00:00:00`) : new Date(e.start.dateTime);
            const end = allDay ? new Date(`${e.end.date}T00:00:00`) : new Date(e.end.dateTime);
            const meet = e.hangoutLink ?? e.conferenceData?.entryPoints?.find((p: any) => p.entryPointType === "video")?.uri;
            return { account, id: e.id, title: e.summary || "(No title)", start, end, allDay, meet, location: e.location, link: e.htmlLink };
          });
      } catch (err) {
        errors.push({ account, message: String(err) });
        return [];
      }
    })
  );
  const events = lists.flat().filter((e) => e.end > now).sort((a, b) => +a.start - +b.start);
  return { events, errors };
}

export interface NewMeeting {
  title: string;
  start: Date;
  end: Date;
  guests: string[];
  meet: boolean;
  location: string;
  description: string;
}

export async function createMeeting(account: string, m: NewMeeting): Promise<void> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const body: any = {
    summary: m.title,
    location: m.location || undefined,
    description: m.description || undefined,
    start: { dateTime: m.start.toISOString(), timeZone: tz },
    end: { dateTime: m.end.toISOString(), timeZone: tz },
    attendees: m.guests.map((email) => ({ email })),
  };
  if (m.meet) {
    body.conferenceData = {
      createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } },
    };
  }
  // sendUpdates=all emails the invitations to the guests.
  await googleApi(account, "POST", `${CAL}/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all`, body);
}

/** Open tasks from each account's default list ("My Tasks"). */
export async function openTasks(accounts: string[]): Promise<{ tasks: Task[]; errors: AccountError[] }> {
  const errors: AccountError[] = [];
  const lists = await Promise.all(
    accounts.map(async (account) => {
      try {
        const r = await googleApi<any>(account, "GET", `${TASKS}/lists/@default/tasks?showCompleted=false&maxResults=50`);
        return (r.items ?? [])
          .filter((t: any) => t.title?.trim())
          .map((t: any): Task => ({
            account,
            list: "@default",
            id: t.id,
            title: t.title,
            // Google stores a due *date* as midnight UTC; read it as that calendar day.
            due: t.due ? new Date(`${t.due.slice(0, 10)}T00:00:00`) : undefined,
            notes: t.notes,
          }));
      } catch (err) {
        errors.push({ account, message: String(err) });
        return [];
      }
    })
  );
  const tasks = lists.flat().sort((a, b) => (a.due ? +a.due : Infinity) - (b.due ? +b.due : Infinity));
  return { tasks, errors };
}

export async function createTask(account: string, title: string, due: string | null, notes: string): Promise<void> {
  await googleApi(account, "POST", `${TASKS}/lists/@default/tasks`, {
    title,
    notes: notes || undefined,
    due: due ? `${due}T00:00:00.000Z` : undefined,
  });
}

export async function completeTask(t: Task): Promise<void> {
  await googleApi(t.account, "PATCH", `${TASKS}/lists/${encodeURIComponent(t.list)}/tasks/${encodeURIComponent(t.id)}`, {
    status: "completed",
  });
}

/** "Today", "Tomorrow", "Fri", or "Dec 2". */
export function dayLabel(d: Date): string {
  const today = new Date();
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((d0 - t0) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (diff > 1 && diff < 7) return d.toLocaleDateString("en-US", { weekday: "short" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export const timeLabel = (d: Date) => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

/** Text field values for "today" and "the next half hour". */
export function defaultSlot(): { date: string; start: string; end: string } {
  const d = new Date();
  d.setMinutes(d.getMinutes() < 30 ? 30 : 60, 0, 0);
  const e = new Date(d.getTime() + 30 * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const ymd = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return { date: ymd, start: `${pad(d.getHours())}:${pad(d.getMinutes())}`, end: `${pad(e.getHours())}:${pad(e.getMinutes())}` };
}
