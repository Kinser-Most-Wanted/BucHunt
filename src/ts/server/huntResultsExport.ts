import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import type { HuntDefinition } from "../foundation/types.js";

export interface HuntResults {
  hunt: HuntDefinition;
  tasks: { id: string; label: string }[];
  players: {
    id: string;
    displayName: string | null;
    completed: number;
    statuses: boolean[];
  }[];
}

export function buildHuntResults(
  hunt: HuntDefinition,
  participants: {
    playerId: string;
    completedTaskIds: string[];
    displayName?: string | null;
  }[],
): HuntResults {
  const tasks = [...hunt.tasks]
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((task) => ({ id: task.id, label: task.displayLabel }));
  return {
    hunt,
    tasks,
    players: participants
      .map((player) => {
        const completed = new Set(player.completedTaskIds);
        const statuses = tasks.map((task) => completed.has(task.id));
        return {
          id: player.playerId,
          displayName: player.displayName ?? null,
          completed: statuses.filter(Boolean).length,
          statuses,
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function csvCell(value: string | number): string {
  let text = String(value);
  // Quoting alone does not prevent spreadsheet formula execution.
  const firstVisible = Array.from(text).find(
    (character) => character.charCodeAt(0) > 31 && !/\s/u.test(character),
  );
  if (
    (firstVisible && "=+@-".includes(firstVisible)) ||
    /^[\t\r\n]/u.test(text)
  )
    text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function resultsCsv(results: HuntResults): string {
  const headers = [
    "Player ID",
    "Display name",
    "Completed",
    "Incomplete",
    ...results.tasks.map((task, i) => `T${i + 1} - ${task.label} (${task.id})`),
  ];
  const rows: (string | number)[][] = results.players.map((player) => [
    player.id,
    player.displayName ?? "",
    `${player.completed} / ${results.tasks.length}`,
    results.tasks.length - player.completed,
    ...player.statuses.map((status) => (status ? "Completed" : "Incomplete")),
  ]);
  return (
    [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") +
    "\r\n"
  );
}

// Standard PDF fonts are portable and require no deployed font files. Preserve
// unsupported characters as visible code points instead of silently dropping them.
function printable(text: string, font: PDFFont): string {
  return Array.from(text)
    .map((character) => {
      if (character === "\n") return character;
      if (/\s/u.test(character)) return " ";
      try {
        font.encodeText(character);
        return character;
      } catch {
        return `[U+${character.codePointAt(0)!.toString(16).toUpperCase()}]`;
      }
    })
    .join("");
}

function lines(
  text: string,
  width: number,
  size: number,
  font: PDFFont,
): string[] {
  const result: string[] = [];
  for (const paragraph of printable(text, font).split("\n")) {
    let line = "";
    for (const character of paragraph) {
      if (line && font.widthOfTextAtSize(line + character, size) > width) {
        result.push(line);
        line = "";
      }
      line += character;
    }
    result.push(line);
  }
  return result;
}

export async function resultsPdf(results: HuntResults): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.setTitle(`${results.hunt.name} - Hunt results`);
  const font = await document.embedFont(StandardFonts.Helvetica);
  const bold = await document.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.09, 0.2, 0.3);
  let page: PDFPage;
  let y = 0;
  const margin = 36;
  const width = 720;
  const newPage = () => {
    page = document.addPage([792, 612]);
    y = 570;
    page.drawText("BUCHUNT / RESULTS EXPORT", {
      x: margin,
      y,
      size: 15,
      font: bold,
      color: ink,
    });
    y -= 26;
  };
  const paragraph = (text: string, size = 10, strong = false) => {
    const face = strong ? bold : font;
    for (const line of lines(text, width, size, face)) {
      if (y < 55) newPage();
      page.drawText(line, { x: margin, y, size, font: face, color: ink });
      y -= size + 4;
    }
    y -= 7;
  };
  const date = (value: string | null) =>
    value === null ? "No end date" : new Date(value).toISOString();
  newPage();
  paragraph(results.hunt.name, 17, true);
  paragraph(`Description: ${results.hunt.description}`);
  paragraph(
    `Hunt ID: ${results.hunt.id}\nCreated by (owner ID): ${results.hunt.ownerId}\nParticipants with saved records: ${results.players.length}\nStart (UTC): ${date(results.hunt.beginsAt)}\nEnd (UTC): ${date(results.hunt.endsAt)}`,
  );
  paragraph(
    "Incomplete means no saved completion for the current task. Players who left the hunt are absent. Results reflect current tasks and saved participation at export time.",
    9,
  );
  const sections = Math.max(1, Math.ceil(results.tasks.length / 3));
  for (let section = 0; section < sections; section++) {
    if (section > 0 || y < 185) newPage();
    const firstTask = section * 3;
    const tasks = results.tasks.slice(firstTask, firstTask + 3);
    const widths = [
      185,
      95,
      65,
      65,
      ...tasks.map(() => (width - 410) / tasks.length),
    ];
    const headers = [
      "Player ID",
      "Display name",
      "Completed",
      "Incomplete",
      ...tasks.map((_, i) => `T${firstTask + i + 1}`),
    ];
    const heading = () => {
      paragraph(
        `Player task status${sections > 1 ? ` - task section ${section + 1} of ${sections}` : ""}`,
        12,
        true,
      );
      let x = margin;
      headers.forEach((header, i) => {
        page.drawRectangle({
          x,
          y: y - 20,
          width: widths[i],
          height: 25,
          color: ink,
        });
        page.drawText(header, {
          x: x + 5,
          y: y - 10,
          size: 9,
          font: bold,
          color: rgb(1, 1, 1),
        });
        x += widths[i];
      });
      y -= 25;
    };
    heading();
    if (!results.players.length) {
      y -= 18;
      paragraph("No participants with saved records.");
    }
    for (const [row, player] of results.players.entries()) {
      const cells = [
        player.id,
        player.displayName ?? "Not set",
        `${player.completed} / ${results.tasks.length}`,
        String(results.tasks.length - player.completed),
        ...tasks.map((_, i) =>
          player.statuses[firstTask + i] ? "Completed" : "Incomplete",
        ),
      ];
      const wrapped = cells.map((cell, i) =>
        lines(cell, widths[i] - 10, 9, font),
      );
      const height = Math.max(
        32,
        Math.max(...wrapped.map((cell) => cell.length)) * 12 + 14,
      );
      if (y - height < 50) {
        newPage();
        heading();
      }
      let x = margin;
      wrapped.forEach((cell, i) => {
        page.drawRectangle({
          x,
          y: y - height,
          width: widths[i],
          height,
          color: row % 2 === 0 ? rgb(0.94, 0.96, 0.98) : rgb(1, 1, 1),
        });
        cell.forEach((line, j) =>
          page.drawText(line, {
            x: x + 5,
            y: y - 15 - j * 12,
            size: 9,
            font,
            color: ink,
          }),
        );
        x += widths[i];
      });
      y -= height;
    }
    y -= 22;
    paragraph("Task key", 11, true);
    for (const [i, task] of tasks.entries())
      paragraph(`T${firstTask + i + 1} - ${task.label} (${task.id})`, 9);
  }
  paragraph(
    "Dates use UTC. Optional display names may not be unique. Unsupported PDF characters appear as [U+code]; CSV retains the original Unicode text.",
    8,
  );
  const pages = document.getPages();
  pages.forEach((p, i) =>
    p.drawText(`Page ${i + 1} of ${pages.length}`, {
      x: margin,
      y: 22,
      size: 8,
      font,
      color: ink,
    }),
  );
  return document.save();
}
