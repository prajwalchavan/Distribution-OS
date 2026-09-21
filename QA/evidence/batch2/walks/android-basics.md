# android-basics — Pixel 7 basic sanity pass (2026-09-21)

**Verdict: NOT PROVEN. No app leg was walked.** The machine failed this block's own
pre-boot check by a wide margin, on both readings, sustained over 2 minutes of sampling.
Nothing was started, nothing was installed, nothing was killed.

Founder's framing for this run: "For now basics can be done." The basics were not
affordable today. This is a refusal on measurement, not an opinion — the block's brief
says so explicitly ("Wave 3 lost a simulator walk to exactly this and was right to refuse
rather than thrash"), and a live walk from another block was running on this machine
throughout.

---

## 1. What I started, and on which ports

**Nothing.** No service, no Metro, no emulator, no database work.

| | |
|---|---|
| Ports opened by me | none |
| Processes started by me | one `bash` memory sampler (pid 74208), killed before returning — confirmed gone |
| Device actions by me | one `adb exec-out screencap` (read-only) |
| Database | `dos_test_b2_walks` **not connected to, not migrated, not re-seeded** — no walk needed it. `dos` and `dos_qa` never touched. |
| Things I found running and left alone | :3000–:3007 + :3010 (pids 99661–99708), an all-in-one (pid 10424, 2 h 30 m old), a pw-server (pid 14373), a Metro on :5274 (pid 72817), the Pixel_7_API_36 emulator (pid 82296, up 1 d 14 h), and a Chromium headless walk that started at 11:06 (pids 73979/73982/73991) |

The emulator was **already booted by another block** (`-avd Pixel_7_API_36 -memory 3072
-no-snapshot-save`), so I never had to boot one and never stopped one.

---

## 2. The machine check — the reason for the refusal

Block threshold: refuse if **free RAM < ~300 MB** or **swap > ~85% full**.

### First reading, 11:04 (before touching anything)

```
vm_stat      Pages free: 2362        → 2362 × 16384 B = 38.7 MB free
sysctl       vm.swapusage: total = 9216.00M  used = 7971.69M  free = 1244.31M
                                     → 86.5% of swap in use
```

Both thresholds already breached: 38.7 MB free (12.9% of the 300 MB floor) and 86.5% swap.

### Sustained sampling, 11:07:43 → 11:09:43 (13 samples, 10 s apart)

```
11:07:43 freeMB=48   swapUsedM=8446.81
11:07:53 freeMB=62   swapUsedM=9818.69
11:08:03 freeMB=37   swapUsedM=9581.75
11:08:13 freeMB=606  swapUsedM=9536.62
11:08:23 freeMB=63   swapUsedM=8800.50
11:08:33 freeMB=35   swapUsedM=9175.12
11:08:43 freeMB=53   swapUsedM=10314.94
11:08:53 freeMB=68   swapUsedM=10756.69
11:09:03 freeMB=31   swapUsedM=9444.62
11:09:13 freeMB=20   swapUsedM=9641.94
11:09:23 freeMB=60   swapUsedM=9982.44
11:09:33 freeMB=53   swapUsedM=8592.88
11:09:43 freeMB=134  swapUsedM=8499.62
```

- **Free RAM: min 20 MB, max 606 MB, mean 98 MB.** Excluding the single 606 MB blip
  (which lasted under 10 s), the mean is **55 MB** — under one fifth of the floor.
- **Swap in use: min 8447 MB, max 10757 MB, mean 9430 MB.**
- **The OS grew the swap store twice while I watched: 9216 MB → 10240 MB → 11264 MB.**
  Occupancy never fell below ~86%; final reading `total = 11264.00M used = 9967.00M`
  = **88.5%**. macOS expanding its backing store by 2 GB in two minutes is the system
  telling us it cannot keep the working set resident.

### Machine shape

```
hw.memsize                8 GB total
Pages wired down          140604  → 2.2 GB unswappable
Pages occupied by compressor 186098 → 2.9 GB of RAM spent holding
Pages stored in compressor  1363661 → 21 GB of data compressed into it
```

2.2 GB wired + 2.9 GB of compressor on an 8 GB machine leaves very little for a Metro
bundler (~1.5–2 GB resident for an app this size), and a second all-in-one on :3100 would
have wanted ~250 MB more on top.

### The independent proof that the device itself is paged out

The emulator process holds **61 MB resident** against `-memory 3072` — its 3 GB guest is
almost entirely compressed/swapped out. The cost of that is measurable:

```
time adb exec-out screencap -p > android-basics-pixel7-device-idle.png
  → 0.01s user  0.09s system  0% cpu  28.137 total
```

**One screenshot of an idle launcher took 28.1 seconds** (1–2 s is normal). 0% CPU across
28 s means the time was spent waiting on paging, not computing. A basics walk of one app
needs dozens of taps and `uiautomator dump` round-trips; at ~28 s each, one app alone runs
into hours, before Metro has bundled anything.

Screenshot: `android-basics-pixel7-device-idle.png` — Pixel launcher, **Mon, Sep 21**,
clock 11:08, matching the host date, so the device is genuinely alive and reachable. It is
sitting at `com.google.android.apps.nexuslauncher/.NexusLauncherActivity` with no DOS app
in the foreground.

Refusing also protected another block: a Chromium headless walk started at 11:06 and was
running throughout. Starting ~2 GB of Metro with ~1.3 GB of swap headroom left would most
likely have OOM-killed it.

---

## 3. What I did establish, cheaply, for whoever runs the end pass

These are read-only measurements that cost no memory. They are not the claims this block
owed — they are groundwork so the end pass does not rediscover them.

### 3a. Six of the seven apps are already installed on the Pixel 7; the retailer app is not

`adb shell pm list packages -3`, then `dumpsys package <pkg> | grep lastUpdateTime`:

| App | Package | On device | lastUpdateTime |
|---|---|---|---|
| owner | `in.distributionos.owner` | yes | 2026-09-13 04:30:53 |
| manager | `in.distributionos.manager` | yes | 2026-09-13 05:50:36 |
| sales | `in.distributionos.sales` | yes | 2026-09-19 16:08:30 |
| warehouse | `in.distributionos.warehouse` | yes | 2026-09-14 08:32:56 |
| delivery | `in.distributionos.delivery` | yes | 2026-09-19 21:11:15 |
| admin | `in.distributionos.admin` | yes | 2026-09-12 19:39:56 |
| **retailer** | `in.distributionos.retailer` | **NOT INSTALLED** | — |

Also present: `io.appium.settings`, `io.appium.uiautomator2.server`,
`io.appium.uiautomator2.server.test` (left by an earlier block's driver).

The retailer app **was** on this device earlier in the batch —
`lean-retailer-platform-pixel7-r2-home.png`, `-r7-order.png` and friends are in this same
evidence directory — so it has been uninstalled since. Its APK is on disk and current
(`frontend/retailer-app/android/app/build/outputs/apk/debug/app-debug.apk`, 92.06 MB,
Sep 7 17:06), so the end pass needs one `adb install -r` and no Gradle. This is device
state, not a product fault, so no finding was filed for it.

Every install date above is **older than the code this batch has been proving** — the
newest is sales at 2026-09-19. None of the seven carries this batch's later fixes, so the
end pass must reinstall all seven regardless, not just the retailer.

### 3b. Every debug APK needs a live Metro — none can be walked standalone

`unzip -l frontend/sales-app/.../app-debug.apk` → **1293 files, 135,983,005 bytes
uncompressed, and zero `index.android.bundle`** (grep count 0). `assets/` holds only
`app.config` and three mlkit barcode models. These are dev builds that fetch JS from a
development server.

The consequence for planning the end pass: **each app leg costs its own Metro** (~1.5–2 GB
resident), they cannot be batched cheaply, and there is no "just launch the APK" shortcut
that proves a sign-in. All seven debug APKs exist and are dated Sep 6–7:

```
admin      92.06 MB  Sep 7 19:20      retailer   92.06 MB  Sep 7 17:06
delivery   92.06 MB  Sep 7 13:05      sales      92.06 MB  Sep 7 02:00
manager    90.25 MB  Sep 6 20:03      warehouse  92.06 MB  Sep 7 06:47
owner      90.25 MB  Sep 6 16:26
```

---

## 4. Claims this block owed, and their verdicts

| # | Claim | Verdict | Why |
|---|---|---|---|
| 1 | Each of the seven apps builds and launches on the Pixel 7 | **not-proven** | No app was launched. Machine below threshold; no Metro affordable. Measured: 6/7 installed from older builds, retailer absent. |
| 2 | A real sign-in works in each app | **not-proven** | No app was launched; no auth service was started. |
| 3 | The main screen renders with real data from the services | **not-proven** | Same. No backend was started on :3100. |
| 4 | Sales — one order placed from the device reaches the server | **not-proven** | Not attempted. |
| 5 | Delivery — one doorstep delivery recorded from the device | **not-proven** | Not attempted. |
| 6 | Warehouse — one pick recorded from the device | **not-proven** | Not attempted. |
| 7 | The offline outbox survives an app kill (phone-only) | **not-proven** | Not attempted. |
| 8 | The doorstep money gate at D8 (phone-only) | **not-proven** | Not attempted. |
| — | The machine can carry an Android walk right now | **disproven, measured** | Free RAM mean 98 MB (min 20) vs a 300 MB floor; swap 86–100% of a store the OS grew 9216→11264 MB; 28.1 s for one idle screencap. Screenshot: `android-basics-pixel7-device-idle.png`. |

No iOS work was attempted — deliberately out of scope for this run.

---

## 5. Findings filed

**None.** Everything I measured is environment or device state, not product behaviour. No
S-row and no DOS block was added to `QA/findings/12-batch2-new-findings.md`; the highest
S-row there remains **S-182**. Filing an environment reading as a product finding would be
noise.

---

## 6. Still not proven — honest and complete

Everything this block owed is still owed. Nothing on the list below has any Android
evidence from today:

1. **All eight claims in §4** — seven apps launching, seven sign-ins, seven main screens
   with live data, the three field-app writes (sales order, doorstep delivery, warehouse
   pick), the offline outbox surviving an app kill, and the D8 doorstep money gate.
2. **The retailer app on Android at all this batch** — not installed on the device, so it
   is the only app with neither a current install nor today's evidence.
3. **Whether any of the seven current APKs still builds** — I read APKs dated Sep 6–7 off
   disk and never ran Gradle. A build regression since then would be invisible to this
   report.
4. **Whether the installed builds match the code this batch proved** — they do not: the
   newest install is 2026-09-19 and the batch has moved since. Every phone claim in this
   batch that rests on those installs rests on stale binaries.
5. **iOS, entirely** — out of scope by instruction, still the one unproven target.

### What the end pass needs from the machine

The blocker is capacity, not code. Before the full both-platform validation:

- Free RAM must be **> 300 MB** and swap **< 85%** of a store the OS is not actively
  growing. Neither held at any point today.
- Budget ~1.5–2 GB per Metro, plus ~250 MB for an all-in-one on :3100, plus the 3 GB the
  emulator wants actually resident rather than compressed. On this 8 GB machine, with
  2.2 GB wired and 2.9 GB spent on the compressor, that means running the Android pass
  when no other block is walking — the four other walks sharing this machine today are
  what pushed it over.
- A useful pre-flight, one line, before committing to a leg:
  `time adb exec-out screencap -p > /dev/null` — under ~3 s means the guest is resident;
  28 s means it is not, and the pass will not finish.
