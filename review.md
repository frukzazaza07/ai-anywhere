# รีวิวโปรเจกต์ AI Anywhere

วันที่รีวิวและประเมินความพร้อม release: 13 ตุลาคม 2026  
เวอร์ชันใน `package.json`: `1.0.0-beta.1`  
ฐาน commit: `b319bfd` พร้อมการเปลี่ยนแปลงใน working tree ที่ยังไม่ได้ commit

ตรวจจากโค้ด เอกสาร ชุดทดสอบ และรายการไฟล์ที่จะเผยแพร่ใน working tree ปัจจุบัน ประเมินเป้าหมายเป็น source release สำหรับผู้ใช้ที่ไว้วางใจกัน ตามขอบเขต beta ของโปรเจกต์ รอบนี้แก้เฉพาะรายงาน ไม่แก้โค้ดแอปพลิเคชัน ไม่ลงทะเบียนคำสั่ง Discord และไม่สร้าง tag หรือเผยแพร่ release

**ผลประเมิน: ยังไม่พร้อมปล่อย public beta ตาม release gates ของโปรเจกต์ และยังไม่พร้อม stable release** ข้อบกพร่อง model/effort ทั้งสองจุดจากรีวิวเดิมถูกแก้แล้วและตรวจยืนยันซ้ำผ่าน Build, dependency audit, source scan และชุดทดสอบบางส่วนผ่าน แต่ยังไม่มีผลชุดทดสอบเต็มบน candidate นี้ ไม่มีหลักฐาน clean install/Discord/CLI smoke tests และยังมีข้อความใน release notes ที่ไม่ตรงกับพฤติกรรมปัจจุบัน

**สิ่งที่ต้องปิดก่อน release**

1. **ยังยืนยันการทำงานของ candidate เต็มชุดไม่ได้** — `npm test` ถูกบล็อกด้วย `spawn EPERM` ก่อนเริ่มทั้ง 23 test files การรันบางส่วนแบบ in-process ยืนยันตรรกะได้ แต่ยังไม่ยืนยันการสร้าง process, stdin, timeout และการหยุด process tree จริง ขณะตรวจ `.github/workflows/ci.yml` ยังเป็นไฟล์ untracked จึงยังไม่มีผล CI ของ working tree ชุดนี้ที่ใช้อ้างอิงได้ ต้องรันชุดเต็มบน final commit ในสภาพแวดล้อมที่รองรับ subprocess และตรวจ matrix ตามแพลตฟอร์มที่ประกาศรองรับ อ้างอิง [workflow](.github/workflows/ci.yml) และ [release verification](docs/release-verification.md#maintainer-publication-gates)

2. **ยังไม่มีหลักฐานติดตั้งและใช้งานจริง** — ตาราง live verification ยังเป็น `Pending` และ clean install/Discord/providers ระบุ `Not performed` ต้องทดสอบอย่างน้อยบน Windows ซึ่งเป็นเป้าหมาย beta โดยใช้โปรเจกต์ทิ้งได้: registration, สิทธิ์ guild/user/admin, ephemeral replies, follow-up/resume, provider permissions, งานตั้งเวลา และ shutdown/restart หากเปิด Claude/Gemini ต้องทดสอบ CLI รุ่นที่ประกาศด้วย Mock tests และการอ่าน `--help` ไม่ยืนยันพฤติกรรมเหล่านี้ อ้างอิง [บันทึก live installation](docs/release-verification.md#live-installation-record)

3. **[P2] Release notes อธิบายการอนุญาตโมเดลไม่ตรงกับโค้ด** — [docs/release-notes.md:24](docs/release-notes.md#L24) ระบุว่า discovery ไม่ขยาย local allowlists แต่ [src/runtime-config.ts:133](src/runtime-config.ts#L133) รวม CLI-discovered models เข้ากับรายการที่เลือกได้ และ `/ai config`/`/ai models` เรียก refresh ได้สำหรับผู้ใช้ที่ได้รับอนุญาต พฤติกรรมนี้เป็นการออกแบบที่ยอมรับไว้ใน [ADR-008](docs/decisions/008-cli-model-catalogs.md) ไม่ใช่ authorization bypass ที่ค้นพบใหม่ แต่ผู้ดูแลที่อ่าน release notes อาจเข้าใจผิดว่า model IDs ต้องอยู่ใน JSON เท่านั้น ควรแก้เอกสารให้ชัดว่า Discord discovery เพิ่มโมเดลที่เลือกได้ ส่วน guild/user allowlists, provider enablement, paths และ tool permissions ยังคงเดิม

4. **ยังต้องยืนยัน final snapshot และงานของผู้ดูแล** — มี source, tests, scripts และ workflow ที่ยังไม่ commit และ candidate commit/archive hash ยังไม่ระบุ ต้องตรวจซ้ำกับ final commit/แหล่งติดตั้งจริง พร้อมปิดรายการที่โปรเจกต์กำหนดไว้เรื่อง ownership/notices, ช่องทางรายงานช่องโหว่ส่วนตัว และหลักฐาน smoke tests ปัจจุบันมีไฟล์ LICENSE และ SECURITY.md แล้ว แต่การมีเอกสารไม่ใช่หลักฐานว่ารายการเหล่านี้เสร็จ อ้างอิง [TODO.md](TODO.md) และ [publication gates](docs/release-verification.md#maintainer-publication-gates)

ข้อ 1–2 เป็นช่องว่างของหลักฐานการทดสอบ ไม่ใช่ข้อสรุปว่าโค้ดรันจริงแล้วล้มเหลว การดึงหน้า GitHub Actions/Releases ในรอบนี้ไม่สำเร็จ จึงไม่ใช้สถานะ remote ที่ตรวจไม่ได้มายืนยันว่า CI ผ่านหรือไม่ผ่าน

**สถานะข้อค้นพบจากรอบก่อน**

| ข้อค้นพบ | สถานะปัจจุบันและหลักฐาน |
| --- | --- |
| เปลี่ยนโมเดลแล้วเก็บ effort ที่ไม่รองรับ | แก้แล้ว: `save()` ใช้ `validateProviderEffort()` ตรวจ catalog และล้าง effort เดิมเมื่อไม่รองรับ ยืนยันซ้ำว่าเปลี่ยน `m1/high` เป็น `m2` ซึ่งรองรับเฉพาะ `low` แล้วได้ effort เป็น CLI default และ resolve ได้ |
| Refresh/เปลี่ยนหน้าแสดงโมเดลต่างจาก default profile | แก้แล้ว: callback รักษาบริบท default profile ไว้ ยืนยันซ้ำว่าเปิดและ refresh แล้วยังแสดง `m2` ตรงกับค่าที่ใช้รัน |

ทั้งสองจุดมี regression tests ใน [test/provider-preferences.test.ts](test/provider-preferences.test.ts) และผ่านการทดสอบในรอบนี้ ตำแหน่งแก้หลักคือ [src/provider-preferences.ts:74](src/provider-preferences.ts#L74) และ [src/config-picker.ts:87](src/config-picker.ts#L87) จึงไม่ควรนับเป็นข้อบกพร่องค้างอีก

ตรวจพบในโค้ดว่ามีการแก้เพิ่มเติมตาม [security-review.md](security-review.md): discovery ตรวจ CLI version ก่อนเริ่ม protocol, Codex จำกัด stdout ก่อนส่งเข้า `readline` และ release scanner ปฏิเสธ symlink/junction การรีวิวนี้ตรวจโครงสร้างการแก้และรันทดสอบ scanner ส่วนที่รันได้ แต่ไม่ได้ยืนยัน regression ของการเรียก subprocess ทั้งหมดใหม่

**ภาพรวมการทำงาน**

โปรเจกต์เป็นบอต Discord ที่รับ slash commands แล้วเรียก AI coding CLI บนเครื่องของผู้ดูแล รองรับ Codex, Claude Code และ Gemini CLI ใช้ TypeScript แบบ strict, Node.js ตามข้อกำหนด `>=24.17.0` และ `discord.js` บอตเหมาะกับผู้ใช้ที่ได้รับอนุญาตและไว้วางใจกันใน guild ที่กำหนด

คำสั่งหลักคือ `/ai`, `/ai-admin` และ `/help` ครอบคลุมการส่งงาน ดูสถานะ อ่านผลย้อนหลังในหน่วยความจำ ล้างบทสนทนา เลือกโปรเจกต์/provider/model/effort ตั้งเวลา และจัดการ runtime configuration นอกจากนี้มีคำสั่งบนเครื่องสำหรับตรวจการติดตั้ง (`doctor`) ดูโมเดล และลงทะเบียนคำสั่ง Discord

| ส่วนงาน | ไฟล์หลัก | หน้าที่ |
| --- | --- | --- |
| Discord | `bot.ts`, `commands.ts`, `registration.ts` | รับ interaction ตรวจสิทธิ์ ลงทะเบียนคำสั่ง และตอบผู้ใช้ |
| การเลือกและตั้งค่า | `runtime-config.ts`, `selection.ts`, `provider-preferences.ts`, `config-picker.ts` | ตรวจ config/profile บันทึกค่ารายผู้ใช้ และสร้างหน้าตั้งค่า |
| โปรเจกต์และบทสนทนา | `projects.ts`, `project-sessions.ts`, `sessions.ts` | แปลง alias เป็น canonical directory แยก session และควบคุม worker ร่วม |
| การเรียก CLI | `runner.ts`, `agent-runner.ts` | ส่ง prompt ผ่าน stdin จำกัดสิทธิ์ตาม provider และจัดการ timeout/output |
| รายการโมเดล | `model-discovery.ts`, `provider-discovery.ts`, `model-catalog-service.ts` | อ่าน metadata จาก CLI ตรวจข้อมูล และอัปเดต catalog |
| งานตั้งเวลา | `scheduler.ts` | บันทึก/เรียกงาน ตรวจเป้าหมายเดิม และจัดการสถานะหลัง restart |
| ผลลัพธ์และ lifecycle | `results.ts`, `shutdown.ts`, `doctor.ts` | จัดรูปแบบผลลัพธ์ ปิดระบบอย่างเป็นลำดับ และตรวจการติดตั้ง |

เส้นทางงานหลักคือ Discord → ตรวจ guild/user → resolve project/provider/model → จอง worker → เรียก CLI → เก็บผลใน session → ส่งคำตอบแบบ ephemeral งานตั้งเวลาใช้เส้นทางเรียก worker ร่วมกับงานสั่งทันที

**จุดแข็ง**

- แยก session management ออกจาก Discord transport และมี worker guard ร่วมข้ามโปรเจกต์/provider ช่วยลดงานชนกันใน filesystem
- ตัวตนของ session แยกตาม guild/channel/user, canonical directory, provider และ model การเปลี่ยน effort ไม่ทิ้งประวัติของโมเดลเดิม
- ตรวจสิทธิ์ทั้ง guild และ allowlist แยก admin allowlist เพิ่มเติม ปิด mentions และส่งคำตอบแบบ ephemeral รวมถึงมีการตรวจสิทธิ์ใน autocomplete และ component handlers
- เรียก CLI ด้วย `shell: false` และส่งข้อความผ่าน stdin กรองตัวแปร Discord/allowlist ออกจาก worker environment พร้อมแปลงข้อผิดพลาดก่อนแสดงให้ผู้ใช้
- Runtime config ตรวจสอบก่อนเผยแพร่ค่าใหม่ เขียนไฟล์ผ่าน temporary file และควบคุมลำดับการเปลี่ยนค่าร่วมกับการ dispatch งาน
- Schedule บันทึก project alias, directory, provider/model และ effort ไว้ ไม่โยกงานเก่าไปหา default ใหม่ เมื่อเป้าหมายไม่ถูกต้องจะ pause งาน
- มี specs, ADRs, quickstart, security policy และ release checklist ช่วยอธิบายเหตุผลและข้อจำกัดของระบบได้ดี

**ผลตรวจสอบในรอบนี้**

| รายการ | ผล |
| --- | --- |
| TypeScript build | `npm run build` ผ่านด้วย Node `24.21.0` ที่มีอยู่ใน `node-24/` |
| ชุดทดสอบมาตรฐาน | `npm test` รันไม่สำเร็จ: ทั้ง **23 test files** ถูกบล็อกด้วย `spawn EPERM` ก่อนเริ่มทดสอบ |
| การทดสอบแบบไม่แยก subprocess | แปลง source/tests ปัจจุบันเป็น JavaScript ในโฟลเดอร์ชั่วคราว แล้วใช้ `--test-isolation=none`; ผ่าน **141 tests**, ล้มเหลว 0, ข้าม 1 เพราะไม่มีสิทธิ์สร้าง Windows file symlink |
| การยืนยันข้อบกพร่องเดิม | ตรวจทั้ง 2 กรณีผ่านโมดูลที่ build แล้วด้วยข้อมูลจำลอง ผลยืนยันว่าแก้แล้ว |
| Dependency audit | `npm audit --json --ignore-scripts` สำเร็จ รายงาน **0 vulnerabilities** ใน dependency graph 63 รายการ ณ เวลาตรวจ ไม่ครอบคลุม Claude/Gemini ที่ติดตั้งแยก |
| Release source scan | `scripts/release-check.mjs --stdin` ผ่าน **96 candidate files** โดยรับรายการจาก Git รวม metadata/license consistency เป็น heuristic scan ไม่ใช่การรับรองว่าปลอดข้อมูลลับทั้งหมด |
| Package inventory | `npm pack --dry-run --ignore-scripts --json` สำเร็จ **93 entries** ไม่พบ private runtime paths, dependencies, portable Node หรือ generated artifacts ตาม pattern ที่ตรวจ ไม่ได้สร้างหรือเผยแพร่ package |
| Codex binary ที่ติดตั้ง | ตรวจ `--version` ได้ `0.162.1` และตรวจ help ของ `app-server`, `exec`, `exec resume` รูปแบบ options ที่ใช้มีใน CLI รุ่นนี้ ไม่ได้ส่ง prompt หรือทดสอบ model turn |
| Discord/CLI smoke tests และ clean install | ไม่ได้ทำในรอบนี้ และใน release record ยังไม่มีผลยืนยัน |
| Hosted CI ของ final candidate | ยังยืนยันไม่ได้; workflow และไฟล์ใหม่บางส่วนยังไม่ commit |

การรันแบบ in-process เลือกจาก **19 test files** และกรองกรณีที่ต้องเรียก subprocess ออก ชุดที่ผ่านครอบคลุม configuration, authorization, session/project isolation, preferences, catalog service, schedule persistence, shutdown, release-file validation และการจัดรูปแบบข้อความ การข้าม file-symlink test ไม่รวมกรณี subprocess ที่กรองออกก่อนรัน จึงต้องแยกตัวเลขนี้จากผลชุดทดสอบเต็ม

ใช้ Node `24.21.0` จาก workspace และ npm cache ภายใน `.verification/` เก็บ log การทดสอบใน `.verification/release-review-9pg1jK/test-results.log` ข้อมูลรับรองและ private runtime state ไม่ได้ถูกเปิดอ่านโดยขั้นตอน source/package scan ส่วนการตรวจ Codex help มีคำเตือนเรื่องสิทธิ์สร้าง temporary aliases ของ CLI จึงนับเป็นการตรวจ version/argument syntax เท่านั้น

Lockfile SHA-256: `fcb354fbd0cd1e23d5893072ab6fa53fb8bf8409debaf6fc1621d574296b6efc` ผลตรวจทั้งหมดอ้างอิง working tree รอบนี้ ไม่ใช่การรับรอง archive ที่ยังไม่ได้สร้างหรือการเปลี่ยนแปลงภายหลัง

**ข้อจำกัดและงานต่อที่ควรจัดลำดับ**

1. แก้ข้อความเรื่อง model discovery ใน release notes และอัปเดต verification record ให้ตรงกับหลักฐานล่าสุด
2. สรุป source candidate เป็น commit ที่ตรวจย้อนกลับได้ แล้วรัน build, ชุดทดสอบเต็ม, source/artifact scan และ audit กับ candidate นั้น
3. ยืนยัน CI และทำ smoke tests กับ Discord/CLI จริงตาม [release verification](docs/release-verification.md) โดยบันทึก OS, Node, CLI versions และผลแต่ละกรณี
4. ปิด publication checklist ของผู้ดูแล แล้วจึงประเมินอนุมัติ public beta อีกครั้ง; stable release ยังต้องมีผลใช้งานจริงและการแก้ปัญหาจาก beta ตามแผนโปรเจกต์

การแยก handler ใน `bot.ts` และเพิ่ม interaction integration tests ยังเป็นงานปรับปรุงที่มีประโยชน์ แต่ไม่จำเป็นต้องขยาย scope ไปทำทั้งหมดเพื่อปิด release gate รอบนี้

ข้อจำกัดที่เอกสารระบุไว้แล้วคือ session และผลลัพธ์หายเมื่อ restart, `/ai cancel` ไม่หยุดงานที่เริ่มรันแล้ว, ไม่มีคิวงานทั่วไป และ timeout ปิดเป็นค่าเริ่มต้นจึงอาจทำให้ shutdown รอนานไม่สิ้นสุด นอกจากนี้ผู้ใช้และ provider ใช้ OS account/credentials ร่วมกัน การแยก session จึงไม่ใช่ขอบเขตความปลอดภัยระดับระบบปฏิบัติการ ประเด็นเหล่านี้ควรคงไว้ในคู่มือและทดสอบตามขอบเขตที่ประกาศ

`private: true` ใน `package.json` สอดคล้องกับแผนเผยแพร่เป็น source release และป้องกันการ publish npm โดยไม่ตั้งใจ จึงไม่ใช่ข้อบกพร่องสำหรับเป้าหมายนี้ การตรวจ npm package inventory เป็นหลักฐานประกอบเท่านั้น final Git source archive ยังต้องตรวจแยก โดยต้องมี lockfile และไฟล์ติดตั้งครบตามคู่มือ

**ผลการแก้ไขหลังรีวิว — 13 ตุลาคม 2026**

- แก้ P2 ข้อ 1: `ProviderPreferences.save()` ตรวจ effort เดิมกับ capability ของ model ใหม่จาก CLI catalog หากไม่รองรับจะบันทึกเป็น CLI default ส่วนการระบุ effort ที่ไม่รองรับอย่างชัดเจนยังถูกปฏิเสธก่อนบันทึก
- แก้ P2 ข้อ 2: Refresh/เปลี่ยนหน้าใน picker ใช้บริบท preferences/default profile เดิม การเลือก provider/model/effort ยังคงบันทึกทันที
- เพิ่ม regression tests ใน [test/provider-preferences.test.ts](test/provider-preferences.test.ts) ครอบคลุม model ที่รองรับ effort ต่างกันหรือไม่รองรับเลย การเก็บ effort ที่เข้ากันได้ การโหลดค่าหลัง restart การปฏิเสธค่าที่ไม่ถูกต้องโดยไม่เปลี่ยน preferences และ Refresh/เปลี่ยนหน้าก่อนเลือก effort รวมกรณี catalog เปลี่ยนและไม่เปลี่ยน
- `npm run build` ผ่านด้วย Node `24.21.0` และตรวจ strict typing ของไฟล์ทดสอบที่เกี่ยวข้องผ่าน
- ทดสอบแบบ `--test-isolation=none` ผ่าน **31 tests**: preferences/picker, selection, runtime config และ 4 กรณี catalog/provider switching ที่ใช้ข้อมูลจำลอง
- `npm test` ยังถูกบล็อกด้วย `spawn EPERM` ทั้ง 22 test files ก่อนเริ่มทดสอบ จึงยังต้องรันชุดเต็มในสภาพแวดล้อมที่อนุญาต subprocess รวมถึงตรวจ CI และ smoke tests กับ Discord/CLI จริงก่อนออก stable release
