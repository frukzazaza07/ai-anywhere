# Discord AI CLI bot

English: [Quickstart](docs/quickstart.md) · [Beta release notes](docs/release-notes.md) · [Security policy](SECURITY.md) · [Contributing](CONTRIBUTING.md).

ไม่ต้องสร้าง `ai.config.json` ก่อนเริ่มบอต: ตั้ง Discord credentials และ allowlists ใน `.env` แล้วเริ่มบอตได้ ผู้ดูแลรัน `/ai init` เพื่อเปิดแบบฟอร์มถาม default project/profile และสร้างไฟล์ให้โดยไม่ต้อง restart ถ้าไม่ได้กำหนดโฟลเดอร์หรือค่าจาก `.env` ยังใช้ไม่ได้ บอตจะเข้าโหมด setup โดยเสนอ `default` เป็นโฟลเดอร์ที่เริ่มบอต และยังไม่รันงาน AI จนกว่าจะยืนยัน setup สามารถกำหนดโฟลเดอร์อื่นใน `.env` หรือคัดลอก/แก้ไข `ai.config.example.json` ตามวิธีเดิมได้ คำสั่ง init ไม่เขียนทับไฟล์ที่มีอยู่ และต้องมี user ID ในทั้ง `ALLOWED_USER_IDS` และ `ADMIN_USER_IDS` ส่วน credentials, paths และ executable settings ยังคงกำหนดบนเครื่องเท่านั้น รัน `npm run register` อีกครั้งหลังอัปเกรดหากยังไม่มี subcommand นี้ ดู [ขั้นตอน setup](docs/quickstart.md#finish-setup-in-discord-or-use-a-copied-file)

Release candidate: `1.0.0-beta.1` (MIT). Live verification and publication gates are tracked in [TODO.md](TODO.md) and [the release record](docs/release-verification.md). Run `npm run doctor` for local setup checks. Ctrl+C/SIGTERM stops new work, waits for the active task under its existing timeout, saves schedules and closes Discord; a task without a deadline can delay shutdown indefinitely.

บอต Discord สำหรับรัน Codex, Claude Code และ Gemini CLI บนเครื่อง self-host ตอบแบบ ephemeral และปิด mentions มี worker ร่วมหนึ่งตัว และแยกบทสนทนา/ผลลัพธ์ตาม server/channel/user + canonical directory + provider/model

## ติดตั้งและ migration

1. ใช้ Node.js **24.17.0 ขึ้นไป** แล้วรัน `npm ci`
2. คัดลอก `.env.example` เป็น `.env` ใส่ `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID` และ `ALLOWED_USER_IDS` เปิด Developer Mode ใน Discord เพื่อ Copy ID เชิญบอตเข้า server ด้วย scopes `bot` และ `applications.commands` บอตใช้เฉพาะ Guilds intent
3. ใส่ `ADMIN_USER_IDS` หากต้องการใช้ `/ai-admin` ผู้ดูแลต้องอยู่ใน `ALLOWED_USER_IDS` และ guild ที่กำหนดด้วย เว้นว่างเพื่อปิดคำสั่งจัดการ
4. Login CLI ด้วย OS user ที่รันบอต:
   - Codex เป็น dependency ของโปรเจกต์: `npx codex login` และ `npx codex login status`
   - Claude Code เป็น optional native installation: [วิธีติดตั้ง](https://code.claude.com/docs/en/setup), `claude auth login`, `claude auth status` ต้องใช้ stable version >=2.1.248 และมี executable บน PATH หรือระบุ absolute native executable ใน config ห้ามใช้ .cmd/.bat/.ps1/JavaScript wrappers
   - Gemini CLI เป็น optional installation: `npm install -g @google/gemini-cli@0.63.0` แล้วรัน `gemini` เพื่อ login/trust project ต้องใช้ stable version >=0.63.0 ระบุ absolute path ไปยัง JavaScript entry point ใน config บน PowerShell ใช้ `Join-Path (npm root -g) '@google/gemini-cli/dist/index.js'` เพื่อหาตำแหน่ง
5. เลือกตั้งค่าผ่าน Discord: ข้ามการสร้าง `ai.config.json` แล้วรัน `/ai init` หลังบอตเริ่มเพื่อกรอกแบบฟอร์ม หากต้องการ project นอกโฟลเดอร์บอต ให้กำหนด `CODEX_WORKDIR` หรือ `AI_PROJECTS` ใน `.env` ก่อนเริ่ม หรือใช้วิธี manual โดยคัดลอก `ai.config.example.json` เป็น `ai.config.json` แล้วแก้ directory ให้มีอยู่จริง เปิดเฉพาะ providers ที่ติดตั้งแล้ว โฟลเดอร์ธรรมดาที่ไม่มี Git ใช้ได้ มี spaces/Unicode ได้ relative directories อิงตำแหน่ง config file และจะ canonicalize ก่อนใช้งาน
6. รันคำสั่งต่อไปนี้ครั้งเดียวตอนติดตั้ง/อัปเกรด command schema:

```powershell
npm run build
npm test
npm run register
npm start
```

`npm run dev` ใช้รัน source ระหว่างพัฒนา หลังอัปเกรดนี้ การเพิ่มโปรเจกต์/profile หรือเปลี่ยน enablement/default ใช้ reload/คำสั่ง admin ได้โดยไม่ restart หรือ register ใหม่ การเปลี่ยน credentials, allowlists, sandbox หรือ timeout ใน .env ยังต้อง restart

บอตเดิมที่ไม่มี `ai.config.json` ใช้ .env เดิมได้: `AI_PROJECTS`, `AI_WORKDIR`/`CODEX_WORKDIR`, `AI_DEFAULT_PROJECT`, `AI_PROVIDERS`, `AI_DEFAULT_PROVIDER`, `CODEX_MODEL`, `CLAUDE_MODEL`, `GEMINI_MODEL`, `CLAUDE_EXECUTABLE` และ `GEMINI_CLI_SCRIPT` บอตสร้าง profiles ในหน่วยความจำชื่อ codex/claude/gemini ตาม provider ที่เปิด และใช้ default provider เป็น default profile หากใช้ทั้ง projects map และ legacy workdir จะเพิ่ม alias default เว้นแต่มีอยู่แล้ว

เมื่อสร้าง `ai.config.json` จะใช้ไฟล์นั้นเป็นแหล่ง runtime ทั้งชุด โดยไม่ผสม projects/providers/models/defaults จาก .env ตรวจ defaults และ overrides เดิมก่อน `/ai-admin reload` งาน scheduled เก่าจะอิงค่าที่บันทึกไว้ ไม่ย้ายไป default ใหม่

## Runtime configuration

ผู้ใช้ที่ได้รับอนุญาตรัน `/ai config` เพื่อเลือก provider, model และ effort จาก dropdown ได้ แต่ละรายการบันทึกทันที จำแยกตาม server/channel/user และเก็บ model/effort แยกต่อ provider กลับมาเปลี่ยนได้ตลอดและค่ายังอยู่หลัง restart:

```text
/ai config
/ai config provider:codex model:gpt-5.3-codex effort:high
/ai run prompt:ตรวจโค้ดให้หน่อย
/ai run provider:codex model:gpt-5.3-codex effort:low prompt:สรุปโค้ด
```

ถ้า prompt ไม่ระบุ provider/model/effort จะใช้ค่าที่เลือกไว้ ส่วนค่าที่ระบุตอน prompt มีผลเฉพาะครั้งนั้น ไม่แก้ config ที่บันทึกไว้ ผู้ใช้ที่ยังไม่เคยเลือก config ยังคงใช้ default profile กลาง และการระบุ `profile:` จะใช้ model ของ profile นั้น `/ai config` จะดึงรายชื่อ model จาก CLI ของ provider ที่เลือกและรวมกับรายการใน config จึงไม่ต้องเพิ่ม model ID ลง JSON เอง ใช้ปุ่ม **Refresh models from CLI** เพื่อโหลดใหม่หลังติดตั้ง/login หรือเมื่อรายการเปลี่ยน หาก CLI ดึงรายการไม่ได้ บอตจะแสดงคำแนะนำและยังใช้รายการเดิมได้ ใช้ปุ่ม Next/Previous เมื่อรายการยาว และใช้ `model:__default__` หรือ `effort:default` เพื่อเลือก CLI default ค่าถูกเก็บใน `.ai-preferences.json` ส่วน catalog ที่ตรวจสอบแล้วเก็บใน `.ai-config-overrides.json` เพื่อใช้ต่อหลัง restart ทั้งสองไฟล์ไม่ควรนำเข้า Git

Effort มีรายการตาม provider/model และส่งเข้า CLI จริง: Codex ผ่าน `model_reasoning_effort`, Claude ผ่าน `--effort`, Gemini ผ่าน thinking settings ในไฟล์ชั่วคราวที่จำกัดสิทธิ์ไว้เหมือนเดิม CLI ยังตรวจความสามารถของ model/account อีกครั้ง งาน scheduled เก็บ provider/model/effort ตอนสร้างไว้และไม่เปลี่ยนตาม config ส่วนตัวภายหลัง รัน `npm run build`, `npm run register` และ restart บอตหลังอัปเกรดเพื่อเปิดคำสั่ง/ตัวเลือกใหม่

ตัวอย่าง config สำหรับ Codex CLI default:

```json
{
  "version": 1,
  "projects": {
    "web": { "directory": "D:/projects/my-web", "enabled": true },
    "api": { "directory": "E:/work/my-api", "enabled": true }
  },
  "providers": {
    "codex": { "enabled": true, "models": [] }
  },
  "profiles": {
    "default": { "provider": "codex" }
  },
  "defaultProject": "web",
  "defaultProfile": "default"
}
```

Project/profile names เริ่มด้วยตัวอักษรอังกฤษเล็ก ใช้ a-z, 0-9, underscore หรือ hyphen ได้ สูงสุด 32 ตัวอักษร จำนวนโปรเจกต์ไม่ผูกกับเพดาน 25 ของ Discord autocomplete ทุก directory ต้องมีอยู่ แม้รายการถูกปิด

Provider entry มี `enabled`, `models` ซึ่งเป็นรายการ model ที่อนุญาต และ optional `defaultModel` ซึ่งต้องอยู่ในรายการนั้น Claude ใช้ optional `executable` (absolute native path) Gemini ต้องมี `script` (absolute JavaScript entry point) Codex ใช้ dependency ของบอต Model name ต้องตรงรูปแบบที่บอตยอมรับและ CLI/account ต้องรองรับเอง บอตไม่ตรวจ availability กับบริการ model

Profile มี `provider` และ optional `model` ไม่ระบุ model หมายถึง CLI default ซึ่งอนุญาตเสมอ ตัวอย่างเมื่อเพิ่ม model ที่ต้องการใน provider.models แล้ว:

```json
"profiles": {
  "default": { "provider": "codex" },
  "review": { "provider": "claude", "model": "sonnet" }
}
```

Config และ overrides เป็นไฟล์ local ที่ ignore จาก Git เพราะอาจมี paths/settings ส่วนตัว แจกเฉพาะ example เปิดบอตเพียงหนึ่ง instance เก็บ credentials/runtime files นอก directories ที่ AI tools เข้าถึง

## จัดการจาก Discord

```text
/ai-admin status
/ai-admin reload
/ai-admin profile-set name:review provider:claude model:sonnet
/ai-admin profile-set name:plain provider:codex
/ai-admin defaults profile:review project:web
/ai-admin profile-delete name:plain
/ai-admin project project:api enabled:false
/ai-admin provider provider:gemini enabled:false
```

`profile-set` สร้างหรือแทนที่ profile ทั้งชุด เว้น model เพื่อใช้ CLI default การลบ default profile หรือปิด default project/default profile's provider ต้องเปลี่ยน default ก่อน Profiles ของ provider ที่ปิดยังเก็บไว้เพื่อเปิดกลับได้

Discord เปลี่ยนได้เฉพาะ aliases/installations/models ที่เครื่องอนุญาต การเพิ่ม alias/path, เปลี่ยน executable หรือรายการ models ต้องแก้ `ai.config.json` บนเครื่องแล้ว reload คำสั่ง admin บันทึก `.ai-config-overrides.json` แยกจากต้นฉบับด้วย atomic write และตอบสำเร็จเมื่อบันทึกแล้ว Overrides มีลำดับเหนือ config และอยู่ต่อหลัง restart

Reload ตรวจ config + overrides ทั้งชุดก่อนสลับ หาก JSON/schema/directory/model/default หรือ reference ใน overrides ใช้ไม่ได้ จะคงค่าชุดเดิมและตอบ error ที่ไม่เปิดเผย paths/credentials ต้องแก้ overrides ที่อ้างรายการซึ่งถูกลบจากต้นฉบับบนเครื่องด้วย การเปลี่ยน config ถูกปฏิเสธขณะ worker ทำงาน

Config และ schedules ใช้คนละไฟล์ หากบันทึก config สำเร็จแต่บันทึกสถานะ paused ของ jobs ล้มเหลว บอตจะแจ้งว่า config applied แล้ว Jobs พักในหน่วยความจำและจะ retry การบันทึกก่อน dispatch/เปลี่ยน config ต่อ ให้ตรวจ local storage แล้วลองใหม่

## AI model choices

Use `/ai models` to list allowed models and matching profiles for the default
profile's provider, or `/ai models provider:codex` for a specific enabled provider.
The list works while the worker is busy. Select `model` from autocomplete on
`run`, `new`, `status`, `clear` and `result`:

```text
/ai run provider:codex model:MODEL prompt:Review this project
/ai status provider:codex model:MODEL
/ai result provider:codex model:MODEL
```

Replace `MODEL` with an allowed ID from your local catalog. A model-only option
uses the default profile's provider. An explicit profile chooses its own model
and cannot be combined with provider/model options. Model choices apply to that
request; use the same provider/model/project when retrieving or resetting a session.
Scheduled tasks retain the resolved model even when shared defaults change.

Operators can list choices locally without Discord credentials:

```powershell
npm run models
npm run models -- --provider codex --discover
npm run models -- --provider codex --discover --json
```

Discord loads models from each installed CLI: Codex uses the
[app-server model/list protocol](https://learn.chatgpt.com/docs/app-server#list-models-modellist),
Claude reads the [SDK initialization model catalog](https://code.claude.com/docs/en/agent-sdk/typescript#modelinfo),
and Gemini reads [ACP session model choices](https://github.com/google-gemini/gemini-cli/blob/v0.63.0/packages/cli/src/acp/acpSessionManager.ts).
No prompt/model turn is submitted. `/ai config` and `/ai models` publish validated
CLI-reported IDs so they can be selected without manual JSON edits, preserving local
configured entries. Catalogs and model effort capabilities are cached/persisted;
Refresh models from CLI bypasses the short in-process cache. Listing does not prove
account entitlement. If a CLI is unavailable or not logged in, saved/configured
choices remain with a fixed explanation. Busy workers use saved choices until idle.
`npm run models -- --provider claude --discover` and the same command for Gemini
also inspect their CLI metadata; terminal listing does not change configuration.

After this upgrade, run `npm run build`, `npm run register` and restart the bot
to expose `/ai models` and the new `model` options. Model catalog edits only need reload.

## เลือก project และ profile

ใช้ `/help` เพื่อดูความหมาย, options และตัวอย่างของทุกคำสั่ง บอตตอบแบบ ephemeral พร้อม `help.txt` สำหรับคู่มือเต็ม เลือก `/help topic:ai` หรือ `/help topic:admin` เพื่ออ่านเฉพาะส่วน Help ใช้ได้ขณะ worker ทำงานและไม่ต้องมี project/profile ที่ใช้งานได้ รายละเอียดคำสั่ง admin อ่านได้จาก help แต่การใช้คำสั่งจริงยังต้องผ่านสิทธิ์ admin หลังอัปเกรดให้รัน `npm run register`, build และ restart เพื่ออัปเดต `/help` และลบ `/codex` เดิม ใช้ `/ai run provider:codex` เพื่อเรียก Codex

```text
/help
/help topic:ai
/ai projects
/ai project name:web
/ai run profile:review project:web prompt:ตรวจโค้ด
/ai status profile:review project:web
/ai result profile:review project:web
/ai new profile:review project:web
/ai clear profile:review project:web
/ai run provider:codex project:web prompt:ตรวจการเปลี่ยนแปลง
```

| Selection | Behavior |
| --- | --- |
| `/ai profile:…` | ใช้ provider/model ของ profile |
| `/ai provider:…` | Compatibility: ใช้ defaultModel ของ provider นั้น หรือ CLI default |
| `/ai` ไม่ระบุทั้งสอง | ใช้ default profile กลาง ไม่มีการจำ profile รายผู้ใช้ |
| ระบุ provider และ profile พร้อมกัน | ปฏิเสธและให้เลือกอย่างเดียว |

Autocomplete อ่าน config ปัจจุบัน ตรวจสิทธิ์ก่อนแนะนำ และแสดงไม่เกิน 25 รายการต่อครั้ง ค้นหาเพิ่มด้วยการพิมพ์บางส่วน รายการ admin แสดงสิ่งที่ปิดด้วยเพื่อเปิดกลับ Paths ไม่ถูกส่งไป Discord และค่าที่พิมพ์เองจะถูกตรวจซ้ำก่อนใช้

`project name:…` จำ current project แยก server/channel/user ใช้กับ /ai ส่วน `project:` บน session command เปลี่ยนเฉพาะคำสั่งนั้น หาก current project ถูกปิด/ลบ ให้เลือกใหม่อย่างชัดเจน บอตไม่เปลี่ยนไป default project เงียบ ๆ `/ai projects`, `schedules` และ `cancel` ยังใช้ได้

Aliases ที่ชี้ canonical directory เดียวกัน และ profiles ที่ชี้ provider/model คู่เดียวกัน ใช้บทสนทนาเดียวกัน การแก้ profile ไปอีกคู่เลือกอีก session โดยไม่ล้างคู่เดิม กลับมาคู่เดิมแล้ว resume ได้ `new`/`clear` ล้างเฉพาะ session/result ที่เลือก ไม่ลบ project files, CLI disk history หรือตารางงาน

หนึ่ง worker ใช้ร่วมกันทุก project/provider/user งานทันที, project switching และ reset ถูกปฏิเสธเมื่อ busy Status/results/schedule management ยังใช้ได้ Sessions, preferences และผลเต็มเก็บในหน่วยความจำและ reset เมื่อ restart

## สถานะและผลลัพธ์

Codex status แสดง account quota/context usage เมื่อ CLI มีข้อมูล quota เป็นของบัญชี CLI ที่ผู้ใช้แชร์ ไม่ใช่แยกตาม Discord user Context เป็น snapshot response ล่าสุดและประมาณด้วย model window; ช่วงกำลังทำงานจะแสดงว่าเป็น snapshot หากไม่มีข้อมูลจะแสดง unavailable ไม่คาดเดา Claude/Gemini แสดง local worker/session status โดยไม่มี quota/context metrics

บอตรับ prompt สูงสุด 4,000 ตัวอักษร ผลสูงสุด 1 MB ผลยาวแนบเป็นไฟล์ private Discord reply token มีอายุ 15 นาที แต่งานยังทำต่อได้ ใช้ `/ai result` พร้อม project/profile เดิมเพื่อดึงผลหาก reply หมดอายุหรือส่งไม่สำเร็จ ผลล่าสุดถูกแทนเมื่อมีงานใน session นั้นเสร็จ และหายเมื่อ new/clear/restart

## Scheduled jobs

```text
/ai run profile:review project:web prompt:ตรวจ regression after:10m
/ai run profile:review project:web prompt:ตรวจ regression every:2 hours
/ai run provider:codex project:web prompt:ตรวจโปรเจกต์ at:2026-10-20 09:00
/ai schedules
/ai cancel id:ID_FROM_SCHEDULES
```

เลือก at/after/every อย่างเดียว; ไม่ระบุจะทำทันที:
- `at`: YYYY-MM-DD HH:mm ใช้ Bangkok UTC+07:00 หรือ ISO พร้อม Z/offset รองรับวินาที ต้องเป็นอนาคต
- `after`: ครั้งเดียวหลังระยะเวลา เช่น 30s, 10m, 1h 30m
- `every`: ทำซ้ำ ขั้นต่ำ 1 นาที สูงสุด 365 วัน เป็น interval ไม่ใช่ cron

ตารางบันทึกใน `.codex-schedules.json` และอยู่ต่อหลัง restart จำกัด 50 jobs ต่อ user/channel และ 500 รวม งานที่เสร็จเก็บให้ดู/cancel Jobs รอ worker และไม่ overlap รอบที่พลาดจะข้ามเพื่อไม่ replay หลายรอบ งานที่ interrupted ระหว่าง restart ไม่ทำรอบเดิมซ้ำ; repeats เริ่มรอบอนาคต การ cancel ไม่หยุดงานที่กำลังรัน

งานจับ profile + provider/model/project/canonical directory/sandbox ตอนสร้าง การเปลี่ยน preferences/defaults ไม่เปลี่ยนเป้าหมาย งานจะ paused พร้อมเหตุผลหาก profile ถูกลบ/เปลี่ยนคู่, provider/model ไม่ได้รับอนุญาต หรือ project ถูกปิด/ลบ/เปลี่ยน directory ต้อง cancel/recreate แม้เปิดค่าเดิมคืนก็ไม่กลับมารันเอง งานเก่าไม่มี profile ใช้ provider/model/directory เดิม; ไม่มี provider หมายถึง Codex จับคู่ legacy directory กับ alias ที่ตรงกันเท่านั้น

ผลของ scheduled jobs อยู่ใน result cache ส่วนตัวเดียวกับงานปกติ ไม่มี DM หรือโพสต์ผลอัตโนมัติ `schedules`/`cancel` ดูได้ข้าม projects/providers ของเจ้าของใน channel เดิม รวมถึงรายการที่ถูกปิด

## Permissions และ timeout

`CODEX_SANDBOX=read-only` ใช้ตรวจอ่าน; `workspace-write` อนุญาตแก้ไฟล์ตามขอบเขต CLI ใช้กับทุก provider `CODEX_TIMEOUT_SECONDS=0` หรือว่างปิด task deadline ใส่จำนวนวินาทีเต็มบวกเพื่อเปิด ไม่มีหน้าขออนุมัติจาก Discord หากต้องใช้สิทธิ์เพิ่มงานอาจไม่สำเร็จ การ timeout ไม่ rollback ไฟล์ที่แก้แล้ว

Codex ใช้ sandbox และ --skip-git-repo-check Claude ใช้ restricted execution, dontAsk และ file tool allowlist Gemini ใช้ temporary system settings ที่รักษานโยบายเดิมและจำกัด tools ทั้งสองปิด shell tools, hooks และ custom integrations ไม่เปิด permission bypass และ Gemini ไม่โหลด project .env ขอบเขต file tools ของ provider เพิ่มเติมขึ้นกับ CLI ไม่ใช่ OS sandbox

ทุก CLI launch ด้วย shell:false และส่ง prompt ผ่าน stdin ตัด Discord credentials และ user/admin IDs ออกจาก worker environment คำตอบเป็น ephemeral พร้อม disabled mentions เก็บ raw CLI errors ออกจาก Discord

## พัฒนาและตรวจรับ

```powershell
npm run build
npm test
```

Offline tests ใช้ mock CLIs ไม่เรียก models หรือ Discord ครอบคลุม reload/overrides/save failure/admin authorization, autocomplete/typed input, session tuple restoration, shared worker, scheduler races และ legacy migration

หลัง register schema ตอนอัปเกรด ให้ทำ live smoke test ใน server ทดสอบ: สร้าง/แก้ profile, เพิ่ม alias บนเครื่องแล้ว reload, ตรวจ autocomplete เปลี่ยนโดยไม่ restart/register, ลอง unauthorized admin, private result/disabled mentions และ job pause พร้อมเก็บ screenshots Live smoke/screenshots ยังไม่ได้รันในการตรวจ offline นี้

| Module | หน้าที่ |
| --- | --- |
| src/config.ts | Discord/environment settings และ legacy config |
| src/runtime-config.ts | Validation, snapshots, atomic overrides และ mutation gate |
| src/selection.ts, src/admin-config.ts | Selection/autocomplete และ admin authorization |
| src/projects.ts, src/project-sessions.ts, src/sessions.ts | Preferences, session isolation และ shared worker |
| src/commands.ts, src/register.ts, src/bot.ts | Discord schema, registration และ transport |
| src/scheduler.ts | Timing, persistence, fixed job targets และ dispatch |
| src/runner.ts, src/agent-runner.ts | CLI execution, stdin, credential filtering และ restricted tools |
| src/limits.ts, src/context.ts, src/results.ts | Quota/context reporting และ private result delivery |

ดู [runtime spec](SPEC-runtime-config.md) และ [ADR-003](docs/decisions/003-runtime-config-profiles.md) ก่อนเผยแพร่ยังมีงานแยก LICENSE, CONTRIBUTING, SECURITY และ CI ตามด้วย setup/doctor ส่วน durable session/results, queue และหยุดงานเป็นรอบถัดไป

รายการงานก่อนเผยแพร่และลำดับความสำคัญ: [TODO.md](TODO.md)

## แก้ปัญหา

- ไม่เห็นคำสั่งใหม่: ตรวจ client/guild ID, invite scopes แล้วรัน npm run register ครั้งเดียวหลังอัปเกรด
- ไม่มีสิทธิ์ admin: ต้องผ่าน guild + ALLOWED_USER_IDS + ADMIN_USER_IDS
- Reload rejected: ตรวจ ai.config.json และ .ai-config-overrides.json รวมกัน โดยเฉพาะ stale references/defaults และ directories
- Worker failed: ลอง CLI โดยตรงด้วย OS user ของบอต ตรวจ login, version, permissions และ timeout
- ผลไม่ตรง profile: เรียก result ด้วย project/profile เดียวกับงาน คู่ provider/model เป็นตัวกำหนด session
