# TODO: Open-source release readiness

Target: a self-hosted beta for trusted users, followed by a stable release after real installation feedback. This checklist tracks release work; completed feature tasks remain in tasks/.

## Priority 1: AI Anywhere Bot – Development Tasks

### ข้อกำหนดหลัก (ใช้กับทุก Task)

ก่อนเริ่มแก้ไขโค้ด ให้ตรวจสอบโครงสร้างและการทำงานปัจจุบันของโปรเจกต์ก่อน

**กฎที่ต้องปฏิบัติ**

- ห้ามทำให้คำสั่งหรือฟีเจอร์เดิมเสีย
- ใช้โครงสร้างและเทคโนโลยีที่มีอยู่ในโปรเจกต์ให้มากที่สุด
- ไม่เปลี่ยน Architecture โดยไม่จำเป็น
- พัฒนาแยกทีละ Task และทดสอบก่อนเริ่ม Task ถัดไป
- รองรับทั้ง Windows และ Linux ตามสภาพแวดล้อมที่โปรเจกต์ใช้งาน
- จัดการ Error และกรณีผิดปกติให้เหมาะสม
- เมื่อทำเสร็จให้สรุปไฟล์ที่แก้ไข วิธีทดสอบ และผลการทดสอบ
- ไม่แก้ไขส่วนอื่นที่ไม่เกี่ยวข้อง

---

### Task 1: ระบบเก็บประวัติงานและผลลัพธ์ถาวร (Job History)

- [x] **สถานะ (2026-10-15):** เสร็จแล้ว — `src/jobs.ts` (JobHistory/JobManager), `/ai jobs`, `/ai result id:`; เก็บใน `.ai-jobs/` ไฟล์ละงาน, เก็บ 200 งานล่าสุด, เปิดได้เฉพาะเจ้าของ; Schedule แต่ละรอบเป็น Job แยก. ทดสอบ: `test/jobs.test.ts`. เหลือทดสอบจริงบน Discord

**เป้าหมาย:** ผู้ใช้สามารถดูงานย้อนหลังได้ แม้ Bot จะถูกรีสตาร์ต

**สิ่งที่ต้องพัฒนา**

1. เพิ่มคำสั่ง `/ai jobs` เพื่อแสดงรายการงานที่ผ่านมา
2. เพิ่มคำสั่ง `/ai result id:<jobId>` เพื่อดูผลลัพธ์ของงานที่เลือก
3. บันทึกข้อมูลงานลง Persistent Storage ที่เหมาะสมกับ Architecture ปัจจุบัน แทนการเก็บเฉพาะใน Memory
4. ข้อมูลที่ต้องบันทึก ได้แก่ Job ID, ผู้สั่งงาน, คำสั่ง, สถานะ, เวลาเริ่ม, เวลาสิ้นสุด และผลลัพธ์
5. งานที่รันด้วย Schedule ต้องมีประวัติและผลลัพธ์แยกตามแต่ละรอบ โดยไม่เขียนทับกัน
6. รองรับงานที่สำเร็จ ล้มเหลว และถูกยกเลิก
7. ตรวจสอบสิทธิ์การเข้าถึงประวัติและผลลัพธ์ตามผู้ใช้งาน

**เงื่อนไขการทดสอบ**

- สั่งงานและตรวจสอบประวัติผ่าน `/ai jobs` ได้
- เปิดผลลัพธ์ด้วย Job ID ได้ถูกต้อง
- รีสตาร์ต Bot แล้วข้อมูลเก่ายังอยู่
- Schedule ที่รันหลายครั้งมีผลลัพธ์แยกจากกัน

---

### Task 2: ระบบหยุดงานที่กำลังทำงาน (Stop Running Job)

- [x] **สถานะ (2026-10-15):** เสร็จแล้ว — `/ai stop [id:]`; เจ้าของ/Admin เท่านั้น; ฆ่าทั้ง Process Tree และรอให้หยุดจริงก่อนคืน Worker (`src/runner.ts`, `src/agent-runner.ts`). ทดสอบ: `test/jobs.test.ts`, `test/runner.test.ts` (ตรวจว่า Grandchild Process ไม่หลงเหลือ, ผ่านบน Windows). เหลือทดสอบบน Linux/macOS จริง

**เป้าหมาย:** ผู้ใช้สามารถหยุดงานที่สั่งผิดหรือค้างอยู่ได้อย่างปลอดภัย

**สิ่งที่ต้องพัฒนา**

1. เพิ่มคำสั่ง `/ai stop id:<jobId>`
2. อนุญาตให้เจ้าของงานหรือ Admin เท่านั้นที่หยุดงานได้
3. เมื่อสั่งหยุด ต้องยกเลิก Process ที่กำลังทำงาน รวมถึง Child Processes ที่เกี่ยวข้อง
4. ตรวจสอบว่า Process Tree หยุดเรียบร้อยก่อนคืน Worker ให้พร้อมรับงานใหม่
5. อัปเดตสถานะงานเป็น `cancelled` และบันทึกประวัติ
6. รองรับกรณีงานจบแล้ว งานไม่มีอยู่จริง หรือถูกหยุดไปแล้ว
7. ป้องกันไม่ให้คำสั่ง Stop ไปกระทบ Process ของงานอื่น

**เงื่อนไขการทดสอบ**

- สามารถหยุดงานที่กำลังรันได้
- Process และ Child Processes ของงานนั้นหยุดจริง
- Worker กลับมารับงานใหม่ได้หลังหยุดสำเร็จ
- ผู้ใช้ที่ไม่มีสิทธิ์ไม่สามารถหยุดงานคนอื่น
- ไม่มี Zombie Process หลงเหลือจากงานที่ถูกหยุด

---

### Task 3: ระบบคิวงาน (Job Queue)

- [x] **สถานะ (2026-10-15):** เสร็จแล้ว — `/ai run queue:true`, FIFO สูงสุด 5 งาน, รันทีละงาน, แสดงตำแหน่งคิว, ถอนด้วย `/ai stop id:`; รีสตาร์ต/ปิด Bot แล้วงานในคิวถูกยกเลิก (ไม่เริ่มซ้ำ). ทดสอบ: `test/jobs.test.ts`

**เป้าหมาย:** เมื่อ Worker ไม่ว่าง ผู้ใช้สามารถฝากงานรอคิวได้ โดยยังรันทีละงานเหมือนเดิม

**สิ่งที่ต้องพัฒนา**

1. เพิ่มตัวเลือก `queue:true` ในคำสั่งสั่งงาน AI
2. ถ้า Worker ว่าง ให้เริ่มทำงานตามปกติ
3. ถ้า Worker ไม่ว่างและกำหนด `queue:true` ให้นำงานเข้าคิว
4. กำหนดจำนวนงานสูงสุดที่รอในคิวได้ เพื่อป้องกันคิวเต็มไม่จำกัด
5. แสดง Job ID สถานะ และตำแหน่งคิว
6. เมื่อ Worker ว่าง ให้เริ่มงานถัดไปโดยอัตโนมัติตามลำดับ FIFO
7. ผู้ใช้สามารถถอนงานที่ยังรอคิวได้ โดยใช้ `/ai stop id:<jobId>` หรือคำสั่งที่เหมาะสม
8. ป้องกันการเริ่มงานซ้ำ และห้ามมีงานรันพร้อมกันเกินจำนวน Worker ที่กำหนด
9. กำหนดวิธีจัดการงานค้างในคิวเมื่อ Bot รีสตาร์ตอย่างชัดเจน

**เงื่อนไขการทดสอบ**

- Worker ยังคงทำงานทีละงาน
- งานที่รอคิวเริ่มโดยอัตโนมัติเมื่อ Worker ว่าง
- แสดงตำแหน่งคิวได้ถูกต้อง
- สามารถถอนงานออกจากคิวได้
- เมื่อคิวเต็ม ระบบแจ้งผู้ใช้อย่างชัดเจน
- การรีสตาร์ตไม่ทำให้งานเริ่มซ้ำ

---

### Task 4: ระบบติดตามสถานะงานแบบ Real-time (Job Progress)

- [x] **สถานะ (2026-10-15):** เสร็จแล้ว — แก้ไขข้อความตอบกลับเดิมทุก 30 วินาที (`src/bot.ts`), กิจกรรมจาก Event ของ Codex/Gemini เป็น Label คงที่ (`src/activity.ts`), Claude แสดงว่าไม่รายงานระหว่างทำงาน, เตือนอาจค้างเมื่อไม่มี Output 10 นาที. ทดสอบ: `test/jobs.test.ts`, `test/runner.test.ts`

**เป้าหมาย:** ผู้ใช้รู้ว่างานกำลังทำอะไรอยู่ และใช้เวลานานเท่าไร โดยไม่ต้องอ่าน Raw Logs

**สิ่งที่ต้องพัฒนา**

1. แสดงสถานะงาน เช่น `queued`, `running`, `completed`, `failed`, `cancelled`
2. แสดงเวลาที่ใช้ไปตั้งแต่เริ่มงาน (Elapsed Time)
3. แสดงกิจกรรมล่าสุดที่ AI Provider รายงาน เช่น กำลังอ่านไฟล์ กำลังแก้โค้ด หรือกำลังทดสอบ
4. อัปเดตสถานะเป็นระยะโดยไม่ต้องส่งข้อความใหม่ถี่เกินไป
5. ถ้าไม่มีข้อมูลกิจกรรมล่าสุด ให้แสดงสถานะที่ทราบจริง ห้ามสร้างกิจกรรมขึ้นมาเอง
6. แยกกรณีงานยังทำอยู่กับงานที่อาจค้าง โดยใช้ข้อมูลที่ตรวจสอบได้
7. หลีกเลี่ยงการแสดง Raw Logs, Secrets หรือข้อมูลอ่อนไหว
8. เมื่อจบงาน ให้แสดงสถานะสุดท้ายและระยะเวลาทั้งหมด

**เงื่อนไขการทดสอบ**

- ผู้ใช้เห็นเวลาที่ผ่านไปขณะงานกำลังทำ
- แสดงกิจกรรมล่าสุดได้ถ้า Provider รองรับ
- ไม่แสดง Log ดิบโดยไม่จำเป็น
- งานที่เสร็จแล้วหยุดอัปเดตสถานะ
- ระบบติดตามสถานะไม่ทำให้ Worker ทำงานช้าลงอย่างมีนัยสำคัญ

---

### Task 5: ระบบตรวจสอบไฟล์ที่ AI แก้ไข (Git Changes Viewer)

- [x] **สถานะ (2026-10-15):** เสร็จแล้ว — `/ai changes id: [page:]` (`src/changes.ts`); Snapshot ก่อน/หลังงานด้วย Git Index/Object Store ชั่วคราว จึงไม่แตะ Working Tree, Index, Refs; ซ่อนไฟล์/บรรทัดที่น่าจะเป็นความลับ; แบ่งหน้า + แนบไฟล์ .diff. ทดสอบ: `test/changes.test.ts` (Git Repo จริงชั่วคราว). ข้อจำกัด: แยกการแก้ไขด้วยมือระหว่างงานไม่ได้

**เป้าหมาย:** ผู้ใช้สามารถตรวจสอบการเปลี่ยนแปลงโค้ดจากมือถือได้สะดวก

**สิ่งที่ต้องพัฒนา**

1. เพิ่มคำสั่ง `/ai changes id:<jobId>`
2. แสดงรายการไฟล์ที่ถูกเพิ่ม แก้ไข หรือลบโดยงานนั้น
3. แสดง Git Diff ของไฟล์ที่เกี่ยวข้อง
4. แสดงจำนวนบรรทัดที่เพิ่มและลบ
5. จัดรูปแบบผลลัพธ์ให้อ่านง่ายบนมือถือ
6. หาก Diff มีขนาดใหญ่ ให้แบ่งเนื้อหาเพื่อไม่ให้เกินข้อจำกัดของแพลตฟอร์ม
7. รองรับเฉพาะโปรเจกต์ที่เป็น Git Repository
8. ต้องแยกการเปลี่ยนแปลงของ Job นั้นออกจากการเปลี่ยนแปลงที่มีอยู่ก่อน หรือเกิดจากงานอื่น
9. คำสั่งนี้ต้องเป็น Read-only ห้าม Reset, Checkout, Commit หรือแก้ไฟล์โดยอัตโนมัติ
10. ไม่แสดงข้อมูลลับที่อาจปรากฏใน Diff

**เงื่อนไขการทดสอบ**

- แสดงรายชื่อไฟล์ที่ AI เปลี่ยนแปลงได้
- แสดง Diff ที่สัมพันธ์กับ Job ID ได้ถูกต้อง
- ตรวจสอบจากมือถือได้ง่าย
- ไม่รวมการเปลี่ยนแปลงที่ไม่ได้เกิดจาก Job นั้น
- ไม่กระทบ Git Working Tree

---

### ขั้นตอนการทำงานของ Agent

ให้พัฒนาตามลำดับ Task 1 → 2 → 3 → 4 → 5

สำหรับแต่ละ Task:

1. วิเคราะห์โค้ดปัจจุบันและจุดที่ต้องแก้ไข
2. อธิบายแนวทางสั้น ๆ ก่อนลงมือแก้ไข
3. แก้ไขเฉพาะส่วนที่จำเป็น
4. เพิ่มหรือปรับปรุง Test ที่เกี่ยวข้อง
5. ตรวจสอบว่า Existing Features ยังทำงานปกติ
6. สรุปสิ่งที่เปลี่ยนแปลงและผลการทดสอบ

**สำคัญ:** ให้ทำเฉพาะ Task ที่ได้รับมอบหมายในแต่ละครั้ง ไม่พัฒนาทั้ง 5 Tasks พร้อมกัน และไม่ Refactor ระบบที่ไม่เกี่ยวข้อง

---

## Before the first public beta

- [ ] **Required — License:** MIT LICENSE and matching package/lockfile metadata added. Confirm ownership and third-party/native notice requirements before publication; see THIRD_PARTY_NOTICES.md.
- [x] **High — CI:** workflow runs npm ci, npm run build, npm test and release:check on pull requests and main, on Windows/Linux/macOS with Node 24.17.0 and latest Node 24. Hosted results remain pending.
- [ ] **High — Live verification:** test a clean installation, command registration and removal of the legacy /codex command, and the documented Codex/Claude/Gemini versions. Verify authorization, private replies, disabled mentions, provider/project isolation, profile changes, scheduling, and restart behavior. Record tested versions/platforms and capture screenshots without private content.
- [ ] **High — Security policy:** SECURITY.md documents support, private GitHub reporting and the trust/permission model. Repository owner must enable and test the private reporting channel before publication.
- [ ] **High — Publication review:** heuristic source/private-path scan and npm package dry-run passed; credential/runtime exclusions checked; npm audit reported zero advisories. License inventory and native notice limitations recorded. Full history/artifact/ownership/platform notice review remains pending.
- [ ] **Medium — Onboarding:** English quickstart added with minimal Codex-only setup, platform/version status, Discord setup and first task. Real sanitized screenshots remain pending.
- [x] **Medium — Contributions:** CONTRIBUTING.md covers setup, offline tests, conventions, bug reports and pull requests.
- [x] **Medium — Beta release notes:** prepared 1.0.0-beta.1 / proposed v1.0.0-beta.1 tag, with installation/upgrades and known limitations in docs/release-notes.md. No release/tag has been published.

## Before a stable release

- [ ] **High — Graceful shutdown:** implemented SIGINT/SIGTERM admission closure, active task/reply draining, durable schedule completion and Discord closure. Offline persistence/gate tests pass; real signal/restart/provider tests on supported platforms remain pending.
- [ ] **High — Validate real usage:** resolve significant defects from beta installation and provider compatibility reports, then repeat the release smoke tests on supported configurations.
- [x] **Medium — Setup diagnostics:** npm run doctor checks configuration/directories, enabled CLI versions and auth indicators with bounded shell-free probes, fixed summaries and no model requests. Gemini credential freshness/model access require operator verification.

## Later improvements

- [ ] Persist session references across restarts. Saved results now persist as job history (`.ai-jobs/`, newest 200 jobs, owner-only access; see SECURITY.md); CLI session IDs are still in memory only.
- [x] Add cancellation of active tasks with process-tree cleanup and clear partial-change behavior (`/ai stop [id:]`). Live POSIX provider checks remain pending.
- [x] Bounded task queue (`queue:true`, 5 jobs, FIFO) retaining the single-worker guarantee.

## Current verification baseline

On 2026-10-15, after Tasks 1–5, `tsc` passed and the full offline suite passed (302 tests, 1 platform skip for file symlinks) on Windows with Node 24.16.0, run directly via `node --import tsx --test test/*.test.ts` because `npm` could not start in this sandbox. Node 24.16.0 is below the declared >=24.17.0 engine; repeat with `npm run build` / `npm test` on a supported Node. Re-register commands (`npm run register`) for the new options. Live Discord checks are listed in docs/release-verification.md (smoke test 9).

On 2026-10-13 the Node 24.21.0 Windows build passed. Standard npm test was blocked by piped child-process EPERM restrictions in this environment; 88 config/session/schedule/registration/help/init tests and 12 doctor/shutdown tests passed via temporary transpilation and in-process execution. The process-dependent tests still need an unrestricted run. npm audit reported zero advisories; heuristic release scanning and package exclusion checks passed. Live Discord/provider verification (including /ai init), hosted CI, screenshots, ownership/private-reporting activation and full publication review remain outstanding. See docs/release-verification.md for evidence and reproducible smoke tests. Revalidate the final candidate before publication.
