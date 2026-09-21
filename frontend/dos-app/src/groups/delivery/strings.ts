/**
 * The delivery app's own string namespace, merged over the kit catalogue by `<ThemeProvider>`.
 *
 * English only for the pilot (founder, 2026-09-05) — and every user-visible word already has a locale
 * key, so Hindi and Marathi are a translation file, never a rewrite. No component in this app carries
 * a literal English sentence, `src/nav.ts` included.
 *
 * The writing rules of UX-00 §12 apply everywhere below: the trade's own word, a button is verb +
 * object, a refusal states the next action rather than the problem, and there is no "Oops", no "!"
 * and no emoji. A driver reads these at a shop door in the sun, with cash in the other hand.
 */
export const strings = {
  // --- the frame (docs/23 §0) ---------------------------------------------------------------
  'app.home': 'Today',
  'app.signIn': 'Sign in',
  'app.signInTitle': 'Sign in',
  'app.username': 'Username',
  'app.password': 'Password',
  'app.signingIn': 'Signing in',
  'app.signedIn': 'Signed in',
  'app.signInFailed': 'Could not sign in',
  'app.signInBody':
    'Use the username the office gave you. This app works with no signal once you have signed in once.',
  'app.rememberDevice': 'Stay signed in on this device',
  'app.distributor': 'Distributor',
  'app.role': 'Role',
  'app.person': 'Signed in as',
  'app.state': 'State',
  'app.memberships': 'Distributorships this sign-in reaches',
  'app.membershipName': 'Distributor',
  'app.membershipRole': 'Role',
  'app.membershipStatus': 'Status',
  'app.reload': 'Reload details',
  'app.loading': 'Loading the distributorship',
  'app.noMemberships': 'This sign-in reaches one distributor',
  'app.changePassword': 'Change your password',
  'app.passwordForced':
    'This password was given to you by someone else. Set your own before you carry on.',
  'app.passwordVoluntary': 'Choose a new password for this account.',
  'app.currentPassword': 'Current password',
  'app.newPassword': 'New password',
  'app.repeatPassword': 'New password again',
  'app.passwordRule': 'At least 8 characters, with a letter and a digit',
  'app.passwordMismatch': 'The two new passwords are not the same',
  'app.passwordNeedsCurrent': 'Enter the password you signed in with',
  'app.passwordRevokes': 'Your other devices will be signed out.',
  'app.setPassword': 'Set password',
  'app.passwordFailed': 'Could not change the password',
  'app.settings': 'Me',
  'app.signOut': 'Sign out',
  /*
   * DOS-167: signing out, or switching distributor, while this phone still holds changes the office has
   * not got. The founder's rule (2026-09-13): they stay on this phone for that person only; the queued ones
   * go the next time that person signs in here, and the ones needing attention wait in Needs attention and
   * never go by themselves. Nothing is ever thrown away from this sheet. A count of exactly 1 takes the
   * `.one` sentence, and every button is at most 20 characters.
   */
  'leave.title': '{n} changes have not reached the office',
  'leave.title.one': '1 change has not reached the office',
  'leave.bodySignOut':
    'They stay on this phone for {name} only and go the next time {name} signs in here. Nobody else can see them.',
  'leave.bodySignOutRefused':
    'They stay in Needs attention on this phone for {name} only. They do not go by themselves: {name} fixes or discards them there after signing in here. Nobody else can see them.',
  'leave.bodySignOutBoth':
    'They stay on this phone for {name} only. The queued ones go the next time {name} signs in here; the ones needing attention wait there for {name} to fix or discard. Nobody else can see them.',
  'leave.bodySwitch': 'They go when you come back to {tenantName} on this phone.',
  'leave.bodySwitchRefused':
    'They wait in Needs attention until you come back to {tenantName} on this phone. They do not go by themselves.',
  'leave.bodySwitchBoth':
    'The queued ones go when you come back to {tenantName} on this phone; the ones needing attention wait there for you to fix or discard.',
  'leave.bodyMemory':
    'This browser cannot keep them once you leave. Send them now while there is a signal — without one, stay signed in until there is. Anything refused can be fixed or discarded in Needs attention.',
  'leave.attention': '{n} need attention',
  'leave.attention.one': '1 needs attention',
  'leave.sendNow': 'Send now',
  'leave.signOutKeep': 'Sign out, keep here',
  'leave.switchAnyway': 'Switch anyway',
  'leave.noSignal': 'No connection — they cannot go now.',
  /*
   * `app.wrongRoleTitle` / `app.wrongRoleBody` were deleted at the one-app merge (docs/31 §1.3,
   * ruling B3). With a group per role there is no wrong app to be in: the election happens at the
   * Continue-as chooser, the refusal sentence docs/29 §2 states is printed THERE, and the root's
   * ladder takes a person to their own group. A screen that said "this app is for X" would now be a
   * screen about a route.
   */

  // --- the rail / more sheet (labels are <= 14 characters, UX-00 §8.1) ------------------------
  'nav.today': 'Today',
  'nav.day': 'Day summary',
  'nav.expenses': 'Expenses',
  'nav.attention': 'Attention',
  'nav.history': 'Trip history',
  'nav.me': 'Me',

  // --- shared words ---------------------------------------------------------------------------
  'd.unknown': '—',
  'd.close': 'Close',
  'd.back': 'Back to the trip',
  'd.pieces': '{pieces} pc',
  'd.noConnectionRead': 'No connection. This is not the current picture.',
  'd.savedOnPhone': 'Saved on this phone. It goes as soon as there is a signal.',
  /*
   * DOS-179 — the same claims for a store that keeps nothing (the web build in a browser with no
   * OPFS). `keepKey` in src/lib/keep.ts chooses; a screen never reaches for either key itself.
   */
  'd.savedOnPhoneTab':
    'Held in this tab only — not saved. It goes as soon as there is a signal; close this tab and it is gone.',
  'd.offlineWrite': 'No signal — this stays on the phone until there is one.',
  'd.offlineWriteTab':
    'No signal — this is held in this tab only, not saved. Close this tab and it is gone.',
  'd.trip': 'Trip',
  'd.vehicle': 'Vehicle',
  'd.stopsN': '{done} of {total} stops done',
  'd.stopOf': 'Stop {index} of {total}',
  'd.filling': 'Still filling this phone from the office.',
  'd.tripProvisional':
    'Still filling this phone from the office — this may not be the whole trip yet.',
  'd.waitForFill': 'Wait for the phone to finish filling before recording this',
  'd.nothingHere': 'Nothing here yet',
  'd.retry': 'Try again',
  'd.call': 'Call',
  'd.navigate': 'Open in maps',
  'd.noPhone': 'No phone number on this shop',
  'd.noPin': 'This shop has no map pin yet',
  'd.bill': 'Bill',
  'd.billNotHere': 'Bill not on this phone yet',
  'd.bills': 'Bills on this stop',
  'd.due': 'Still due',
  'd.owes': 'Owes {amount}',
  'd.creditTerms': 'Terms',

  // --- D1 today's trip -------------------------------------------------------------------------
  'd1.title': "Today's trip",
  'd1.noTrip': 'No trip is out for you',
  'd1.noTripBody': 'The office plans the trip and the godown loads it. Nothing is on the road yet.',
  'd1.nextStop': 'Next stop',
  'd1.stops': 'Stops in order',
  'd1.load': 'Load on board',
  'd1.loadPlanned': 'Load sheet',
  'd1.loadConfirmed': 'Godown confirmed the load {when}',
  'd1.loadNotConfirmed': 'The godown has not confirmed a load sheet for this trip',
  'd1.loadSheets': '{count} load sheets',
  'd1.loadSheets.one': '1 load sheet',
  'd1.packages': '{count} cartons on board',
  'd1.packages.one': '1 carton on board',
  'd1.packagesPlanned': '{count} cartons planned — not loaded yet',
  'd1.packagesPlanned.one': '1 carton planned — not loaded yet',
  'd1.expectedCash': 'Cash you should be holding',
  'd1.openingCash': 'Float at start',
  'd1.collectedToday': 'Collected today',
  'd1.toCollect': 'Still to collect',
  'd1.startTrip': 'Start this trip',
  'd1.endDay': 'Check in the vehicle',
  'd1.vanSale': 'Sell from the van',
  'd1.addExpense': 'Add an expense',
  'd1.tracking': 'Location is on for this trip',
  'd1.trackingOff': 'Location is off',
  /* DOS-179 — the points this trip has recorded and not sent yet; `keepKey('trackingHeld', …)` chooses. */
  'd1.trackingHeld': '{count} points held on this phone',
  'd1.trackingHeldTab': '{count} points held in this tab only',
  'd1.trackingWeb': 'A browser tab stops sending when it is hidden — keep this tab open.',
  'd1.trackingForeground':
    'The office sees the vehicle while this app is open. It stops when you switch away.',
  'd1.trackingDenied':
    'This phone is not sharing location. The trip still works; the office cannot see it.',
  'd1.tripState': 'Trip is {state}',
  'd1.otherTrips': 'Your other trips',
  'd1.plannedFor': 'Planned for {date}',

  // --- D2 start trip ---------------------------------------------------------------------------
  'd2.title': 'Start the trip',
  'd2.before': 'Before you leave',
  'd2.consentTitle': 'Location while the trip runs',
  'd2.consentBody':
    '{name} sees where this vehicle is only while a trip is running. Tracking stops when you check the vehicle back in. The office keeps the track for {days} days and then deletes it. You can refuse and still drive; the office simply will not see the vehicle.',
  'd2.consentAgree': 'I agree to be tracked',
  'd2.consentRefuse': 'Do not track me',
  'd2.consentGiven': 'You agreed on {when}',
  'd2.consentRefused': 'You refused location on this account',
  'd2.consentNeeded': 'The trip cannot start until you answer the notice above',
  'd2.odometer': 'Odometer at start (km)',
  'd2.openingCash': 'Cash handed to you',
  'd2.openingCashHelp': 'The float the cashier gave you, not a collection',
  'd2.depart': 'Start the trip',
  'd2.departed': 'Trip started',
  'd2.startLoading': 'Tell the godown to load',
  'd2.loadingNow': 'The godown is loading this trip',
  'd2.mustLoadFirst': 'The godown has to load the vehicle before it can leave',
  'd2.openTrip': 'This trip has already left — open its stops',
  'd2.failed': 'Could not start the trip',
  'd2.confirmBody':
    '{trip} on {vehicle}, {stops} stops, float {cash}. You leave with the bills the godown counted out on this trip, and the office starts seeing where the vehicle is.',

  // --- D3 stop ----------------------------------------------------------------------------------
  'd3.title': 'Stop',
  'd3.heading': 'Heading to this stop',
  'd3.arrived': 'I am at the shop',
  'd3.arrivedAt': 'Arrived {when}',
  'd3.geofenceFar': '{metres} m from the shop pin',
  'd3.geofenceNear': 'At the shop pin',
  'd3.toCollect': 'To collect',
  'd3.deliver': 'Deliver this bill',
  'd3.failStop': 'Nothing delivered',
  'd3.collect': 'Take money',
  'd3.vanSale': 'Sell from the van',
  'd3.failTitle': 'Why was nothing delivered?',
  'd3.failReason': 'Reason',
  'd3.failNote': 'What happened',
  'd3.failConfirm': 'Record a failed stop',
  'd3.failBody':
    'Every bill on this stop goes back to the office as undelivered and the goods stay on the van.',
  'd3.failed': 'Stop recorded as failed',
  'd3.done': 'This stop is finished',
  'd3.noBills': 'No bills ride on this stop',
  'd3.notArrived': 'Mark that you have arrived before recording a delivery',
  'd3.eta': 'Expected',
  'd3.arrivedLabel': 'Arrived',
  'd3.openBills': '{count} bills still open at this shop',
  'd3.openBills.one': '1 bill still open at this shop',
  /*
   * DOS-066 — what the person holding the goods knows before they go in. Tell, never block (founder,
   * 2026-09-13): the bill on the van already passed the credit gate at order submit. Only credit mode
   * `stop` earns the chip and the sentence; `strict` and `indicate` look exactly as they did.
   */
  'd3.overdue': 'Overdue {amount} · oldest due {date}',
  'd3.overdueNoDate': 'Overdue {amount}',
  'd3.overdueLabel': 'Overdue',
  'd3.daysLate': '{count} days late on the oldest bill',
  'd3.daysLate.one': '1 day late on the oldest bill',
  'd3.oldestDue': 'due {date}',
  'd3.creditStopped': 'Credit stopped',
  'd3.stoppedLine':
    'The office has stopped credit for this shop — take the money before the goods go in.',

  // --- D4 at the door ----------------------------------------------------------------------------
  'd4.title': 'At the door',
  'd4.lines': 'What is being dropped',
  'd4.delivered': 'Delivered in full',
  'd4.partial': 'Part of it',
  'd4.failedLine': 'Nothing from this bill',
  'd4.line': '{name}',
  'd4.billed': 'On the bill',
  'd4.batch': 'Batch',
  'd4.dropping': 'Dropping',
  'd4.takingBack': 'Taken back',
  'd4.reason': 'Reason',
  'd4.saleable': 'Can be sold again',
  'd4.damaged': 'Into the damaged / expiry bin',
  'd4.short': '{pieces} pc short',
  'd4.receiver': 'Bill signed by',
  'd4.note': 'Note for the office',
  'd4.pod': 'Proof of delivery',
  'd4.podPhoto': 'Photograph the signed bill',
  'd4.podRetake': 'Take it again',
  'd4.podAttached': 'Photo attached',
  // DOS-071: two policies, two sentences — a cash shop under `always` was being told it was on credit.
  'd4.podRequiredCredit': 'This shop is on credit — a photo is required before you can record it',
  'd4.podRequiredAlways': 'The office wants a photo on every delivery',
  'd4.podAttachedMeta': 'Photo attached — it goes with the delivery',
  'd4.podNotRequired': 'A photo is not required here, but it settles arguments later',
  'd4.podNoCamera': 'No camera on this device — attach a file instead',
  'd4.podFailed': 'That photo could not be read. Take it again.',
  /*
   * DOS-070 — WHAT THE GEO PROOF ACTUALLY IS. This used to read "Where you were is attached as proof",
   * printed on a web build whose own home screen said "Location is off — this phone is not sharing
   * location". D4 has never asked the phone for a fix: what travels is `trip_stops.arrived_lat/lng`,
   * the ONE reading taken when the crew tapped "I am at the shop". So the line names that reading and
   * when it was taken — and where there is no arrival fix there is no line, because there is no `geo`
   * row either.
   */
  'd4.podGeoArrival': 'Where you were when you arrived goes with this as proof',
  'd4.podGeoArrivalAt': 'Where you were when you arrived, {when}, goes with this as proof',
  'd4.record': 'Record the delivery',
  'd4.recordOffline': 'Save on this phone',
  'd4.recordOfflineTab': 'Hold until there is a signal',
  'd4.recorded': 'Delivery recorded',
  'd4.creditNote': 'Credit note {no} raised for what did not go in',
  'd4.creditNoteQueued': 'The office raises the credit note when this reaches them',
  'd4.mismatch': 'Dropped plus taken back must equal what is on the bill',
  /* DOS-064 — the pieces pad's own cap: nothing may be dropped that was never on the bill. */
  'd4.atMost': 'Only {pieces} pc are on this bill',
  /*
   * DOS-148 — the bill the godown never counted out. The office refuses it whatever the phone does
   * (`deliveries.record`), and used to refuse it in the order machine's own words, in red, after the
   * crew had photographed a signed bill. Both sentences name the goods and the next action, never the
   * machine: a driver cannot tell from "cannot apply deliver_partial" whether he or the godown is wrong.
   */
  'd4.notLoaded':
    'This bill was not loaded on this van — it is still in the godown. Tell the office; do not hand anything over.',
  'd4.notOnThisVan':
    'This bill is not out for delivery on this van. Tell the office before you hand anything over.',
  'd4.willRecord': 'Will be recorded as {outcome}',
  'd4.alreadyDone': 'This bill is already recorded as {outcome}',
  'd4.failedRecord': 'Could not record the delivery',

  // --- D5 collect ---------------------------------------------------------------------------------
  'd5.title': 'Take money',
  'd5.expected': 'The shop owes',
  'd5.expectedHere': 'Owed on the bills here',
  'd5.expectedLabel': 'Owed on the bills here',
  /*
   * DOS-062 (review): offline, and until `receivables.outstanding.get` answers, the same figure is
   * a sum of FACE values — a part-paid bill makes it an overstatement. The label says which it is.
   */
  'd5.expectedHereAsBilled': 'Owed on the bills here, as billed',
  'd5.expectedLabelAsBilled': 'Owed on the bills here, as billed',
  'd5.amount': 'Amount taken',
  'd5.mode': 'How it was paid',
  'd5.cash': 'Cash',
  'd5.upi': 'UPI',
  'd5.cheque': 'Cheque',
  'd5.reference': 'UPI reference (UTR)',
  'd5.chequeNo': 'Cheque number',
  'd5.chequeDate': 'Cheque date',
  'd5.bank': 'Bank',
  'd5.bookNo': 'Your receipt book number',
  'd5.bookNoHelp':
    'The number you wrote in the paper book, so a printed receipt is never re-numbered',
  'd5.qr': 'Show the UPI QR',
  'd5.record': 'Record the payment',
  'd5.recordOffline': 'Save on this phone',
  'd5.recordOfflineTab': 'Hold until there is a signal',
  'd5.recorded': 'Receipt {no}',
  'd5.recordedQueued': 'Receipt {no} written on this phone',
  'd5.recordedQueuedTab': 'Receipt {no} held in this tab only',
  'd5.settled': 'Settled {count} bills',
  'd5.settled.one': 'Settled 1 bill',
  'd5.cashDiscount': 'Cash discount {amount}',
  'd5.onAccount': '{amount} left on account',
  'd5.stillOwes': 'Still owes {amount}',
  'd5.needsReference': 'A UPI payment needs its UTR; a cheque needs its number',
  'd5.needsChequeDate': 'A cheque needs its date',
  'd5.failed': 'Could not record the payment',
  'd5.print': 'Print the receipt',
  'd5.share': 'Send the receipt',
  'd5.offlineNoNumber':
    'The office numbers the receipt when this reaches them. Write your book number above so the two can be matched.',
  // DOS-062: where the money goes, said before it changes hands and again after the office answers.
  'd5.oldestFirst':
    'Untagged, the office puts this on the oldest of the {count} bills this shop still owes — not always the bill in your hand. Tap a bill to send it there instead.',
  'd5.oldestFirstOne':
    'Untagged, the office puts this on the oldest bill this shop still owes — not always the bill in your hand. Tap a bill to send it there instead.',
  'd5.oldestFirstUntaggable':
    'Untagged, the office puts this on the oldest bill this shop still owes — not always the bill in your hand. What each bill still owes has not come from the office, so a bill cannot be tagged here.',
  'd5.goesTo': 'This money goes to {bills}.',
  'd5.tagRefused':
    'The office says a bill you tagged does not owe that much any more. Untag it and record again — untagged, this money goes to the oldest bill the shop owes.',
  'd5.partPaid': 'part paid',
  'd5.tagged': 'Tagged',
  'd5.paidOff': 'Paid',
  'd5.applied': 'What this money paid',
  'd5.appliedTo': 'This paid {no} {amount}',
  'd5.leftOpen': '{no} is still open — {amount}',
  'd5.appliedOffline':
    'The office allocates this receipt when it reaches them — oldest bill first: a tag needs a signal.',

  // --- D6 van sale ---------------------------------------------------------------------------------
  'd6.title': 'Sell from the van',
  'd6.off': 'Van sales are switched off for this trip',
  'd6.unknown': 'This trip is not on the phone yet, so whether van sales are on is not known',
  'd6.stock': 'What is on the van',
  'd6.pick': 'Add to the sale',
  'd6.lines': 'This sale',
  'd6.total': 'Bill total',
  'd6.quote': 'Priced by the office rules, GST included',
  'd6.beforeGst': 'Before GST',
  'd6.gst': 'GST',
  'd6.roundOff': 'Round-off',
  'd6.collectNow': 'Take the money now',
  'd6.create': 'Bill it and hand it over',
  'd6.created': 'Bill {no}',
  'd6.billed': 'Bill {no} issued',
  'd6.billedNext': 'Take the money on the stop screen',
  'd6.back': 'Back to the stop',
  'd6.needsLine': 'Add at least one item',
  'd6.online': 'A van sale needs a signal: it makes a numbered GST bill.',
  'd6.failed': 'Could not make the sale',
  'd6.available': '{pieces} pc on the van',

  // --- D7 expenses ------------------------------------------------------------------------------
  'd7.title': 'Expenses',
  'd7.kind': 'What for',
  'd7.amount': 'Amount',
  'd7.note': 'Note',
  'd7.proof': 'Photograph the bill',
  'd7.record': 'Record the expense',
  'd7.recorded': 'Expense recorded',
  'd7.today': "Today's expenses",
  'd7.total': 'Spent on this trip',
  'd7.empty': 'Nothing spent on this trip yet',
  'd7.needsNote': 'Say what it was for',
  'd7.failed': 'Could not record the expense',
  'd7.online': 'An expense needs a signal — the office books it against the trip.',
  // DOS-071: the office wants the bill above its own amount; the server is the rule, this is the why.
  'd7.proofRequired': 'Photograph the bill — the office wants one for {amount} or more',

  // --- D8 day summary ----------------------------------------------------------------------------
  'd8.title': 'End of day',
  'd8.expected': 'Cash the office expects',
  'd8.expectedHow': 'Float {opening} + cash taken {cash} − spent {expenses}',
  'd8.cash': 'Cash taken',
  'd8.upi': 'UPI taken',
  'd8.cheque': 'Cheques taken',
  'd8.expenses': 'Spent',
  'd8.stops': 'Stops',
  'd8.delivered': 'Delivered',
  'd8.partial': 'Part delivered',
  'd8.failed': 'Not delivered',
  'd8.vanStock': 'Still on the van',
  'd8.vanStockNote': 'The godown counts this back in when you check in',
  'd8.odometer': 'Odometer now (km)',
  'd8.return': 'Check the vehicle in',
  'd8.returnBody':
    'Stops you have not finished are recorded as not delivered and their bills go back to the office. The goods stay on the van until the godown counts them.',
  'd8.returned': 'Vehicle checked in',
  'd8.handOver': 'Hand {amount} to the cashier',
  'd8.handedOver': 'The office expected {amount} from this trip',
  'd8.uncounted':
    'This phone holds {amount} in receipts that have not reached the office yet. They count into this trip when they arrive; the cash part is already in the figure above.',
  'd8.uncountedSettled':
    'This phone holds {amount} in receipts that reached the office after this trip was settled. Hand any cash to the cashier; the office records the rest.',
  'd8.pendingBlocks':
    '{count} records from this phone have not reached the office yet. They go first; check in when the strip reads Updated.',
  'd8.deskSettles':
    'The cashier counts the money and the godown counts the van. The trip closes at the office, not here.',
  'd8.pending':
    '{count} writes are still on this phone. They go before the office can close the trip.',
  /*
   * DOS-179 — the same four sentences over a store that keeps nothing (a browser with no OPFS), chosen
   * by `keepKey` in src/lib/keep.ts like every other keep verb in this app. The strip above these very
   * screens already reads "· Not kept in this browser", so the phone's words here contradicted it in one
   * render, over the outbox that decides whether the trip may be closed and over money nobody counted.
   * Each tab twin keeps the INSTRUCTION word for word — what goes first, what the office still owes,
   * where the cash goes — and changes only who is holding it.
   */
  'd8.uncountedTab':
    'This tab holds {amount} in receipts that have not reached the office yet, and nothing here is saved. They count into this trip when they arrive; the cash part is already in the figure above.',
  'd8.uncountedSettledTab':
    'This tab holds {amount} in receipts, none of it saved, that reached the office after this trip was settled. Hand any cash to the cashier; the office records the rest.',
  'd8.pendingBlocksTab':
    '{count} records held in this tab only have not reached the office yet. They go first; check in when the strip reads Updated.',
  'd8.pendingTab':
    '{count} writes are held in this tab only, not saved. They go before the office can close the trip; close this tab and they are gone.',
  'd8.failedReturn': 'Could not check the vehicle in',
  'd8.notActive': 'This trip is not out on the road',
  /*
   * S-184. D8 used to borrow `d6.online` here — "A van sale needs a signal: it makes a numbered GST
   * bill." — on a trip with van sales off, while the phone was holding ₹1,544 the office had never
   * seen. Checking in is its own reason: the office is the one that takes the trip back.
   */
  'd8.offlineBlocks':
    'Checking in needs a signal: the office takes the trip back and counts the van.',

  // --- D9 share -----------------------------------------------------------------------------------
  'd9.title': 'Send the papers',
  'd9.invoice': 'Tax invoice',
  'd9.creditNote': 'Credit note',
  'd9.receipt': 'Receipt',
  'd9.pod': 'Proof of delivery',
  'd9.open': 'Open',
  'd9.print': 'Print',
  'd9.share': 'Send on WhatsApp',
  'd9.shared': 'Handed to the phone',
  'd9.notShared': 'Nothing was sent',
  'd9.alreadySent': 'What the office already sent',
  'd9.noMessages': 'The office has sent nothing for this shop yet',
  // DOS-065: today's papers first; the shop's history is one tap away, never the opening screen.
  'd9.thisTrip': 'Taken on this trip',
  'd9.thisBill': 'About this bill',
  'd9.older': 'Older papers for this shop',
  'd9.olderShown': 'Everything for this shop',
  'd9.notAskedMeta': 'Not looked up',
  'd9.notAsked':
    'This bill was not opened from a stop, so this trip’s receipts were not looked up. Older papers for this shop shows what it has paid.',
  'd9.needsSignal': 'The papers are made by the office — this needs a signal.',
  'd9.pdfPending': 'The office is still making this PDF',

  // --- D10 needs attention -------------------------------------------------------------------------
  'tray.title': 'Needs attention',
  'tray.waiting': 'Waiting to send',
  'tray.waitingEmpty': 'Nothing is waiting',
  'tray.waitingCount': 'Waiting: {count}',
  'tray.rejected': 'The office could not accept these',
  'tray.rejectedEmpty': 'Nothing was refused',
  'tray.rejectedCount': 'Refused: {count}',
  'tray.retry': 'Send it again',
  'tray.discard': 'Throw it away',
  'tray.notOnPhone':
    'This phone no longer holds this write. Record it again, then throw this away.',
  /*
   * The same fact about a PAYMENT. The sentence above sends a person back to the doorstep to record the
   * work again, which is right for an arrival or a delivery and wrong for money: the shop has already
   * paid, nothing may be thrown away (never-list #13), and the only thing left is the counter.
   */
  'tray.moneyNotOnPhone':
    'This phone no longer holds the figures for this payment. Hand the money and your book slip to the cashier, who records it at the office.',
  'tray.storeDisk': 'Held on this phone',
  'tray.storeMemory': 'Held in memory only — a reload empties this device',
  /*
   * DOS-178 — a payment the office refused. Never "Throw it away": on a settled trip this card is the
   * only record anywhere that the shop paid. The money goes over the counter to the cashier, who records
   * it at the office against the same paper-book number, and the card stays on the phone as the link.
   */
  'tray.handedOver': 'Handed to the cashier',
  'tray.handCash':
    'The office could not take this on the trip. Hand the money and the slip to the cashier, who records it at the office.',
  'tray.handUpi': 'The money is already in the account. Tell the cashier; the office records it.',
  'tray.money': '{amount} {mode} from {shop} · book no {no} · {when}',
  'tray.moneyNoBook': '{amount} {mode} from {shop} · {when}',
  'tray.handOverBody': '{amount} · {shop} · book no {no} — stays on this phone as handed over',
  'tray.handOverBodyNoBook': '{amount} · {shop} — stays on this phone as handed over',
  /*
   * DOS-179 — the same dialog over a store that keeps nothing, chosen by `keepKey` like every other
   * keep verb in this app. The screen prints `tray.storeMemory` above the list, so the two sentences
   * used to contradict each other in one render. What lasts on a browser with no OPFS is the CASHIER'S
   * entry, not this card, and the dialog says which is which before the crew taps it.
   */
  'tray.handOverBodyTab':
    '{amount} · {shop} · book no {no} — marked handed over in this tab only, not saved. What lasts is the entry the cashier makes at the office.',
  'tray.handOverBodyNoBookTab':
    '{amount} · {shop} — marked handed over in this tab only, not saved. What lasts is the entry the cashier makes at the office.',
  /*
   * DOS-179 — the chip on every waiting row of D10, and the reason it is NOT under `word.`: `wordFor`
   * builds its key from the VALUE (`word.${status}`), so the old `word.queued` — "On this phone" — was
   * reachable with no screen ever naming it, which is how it survived two passes of this sweep twenty
   * lines under `tray.storeMemory`, over rows that include doorstep receipts. Out of that namespace it
   * can only be reached by name, and `keepKey('waitingChip', …)` is the only thing that reaches it.
   * "In this tab only" reads as a place, like its twin, so the chip keeps its shape and its width.
   */
  'tray.waitingOnPhone': 'On this phone',
  'tray.waitingInTab': 'In this tab only',
  'tray.handedOverAt': 'Handed to the cashier at {when}',
  'tray.handedOverCount': 'Handed over: {count}',

  // --- D11 trip history ----------------------------------------------------------------------------
  'd11.title': 'Your trips',
  'd11.empty': 'No trips yet',
  // DOS-067: the register measures ON TIME against the stop's ETA — never a first-attempt rate.
  'd11.onTime': 'On time',
  'd11.window': 'Last 30 days and what is planned',
  'd11.stops': '{done} of {total} done',
  'd11.thisTrip': 'The trip you are on',
  'd11.notThisPhone': 'Not on this phone — read from the office',

  // --- D12 me --------------------------------------------------------------------------------------
  'd12.title': 'Me',
  'd12.thisDevice': 'This phone',
  /* DOS-179 — what the store is holding, said next to what the store IS; `keepKey('tables', …)` chooses. */
  'd12.tablesLabel': 'Tables on this phone',
  'd12.tablesLabelTab': 'Tables in this tab',
  'd12.pending': 'Waiting to send: {count}',
  'd12.devices': 'Your devices',
  'd12.device': 'A device',
  'd12.otherDevice': 'Another device',
  'd12.noDevices': 'Only this device',
  'd12.inbox': 'Inbox',
  'd12.inboxEmpty': 'Nothing has been sent yet',
  'd12.revoke': 'Sign this device out',
  'd12.revokeBody': 'That device will have to sign in again.',
  'd12.target': 'What you are aiming at',
  'd12.targetProgress': '{achieved} of {target}',
  'd12.noTarget': 'No target set for you this month',
  'd12.consent': 'Location',

  /*
   * DOS-064 — THE KIT'S ZERO WORD, SAID BY AN APP THAT HAS NO ORDER SCREENS.
   *
   * `QtyStepper` prints `qty.notOrdered` where the case line would go once a line reaches zero, and the
   * kit's catalogue answers "Not ordered" — true on S3, where a line at zero is an item nobody asked
   * for. Both of this app's steppers mean something else. On D4 the line is PRINTED ON THE BILL in the
   * driver's hand and zero means the shop took none of it; on the van sale it means nobody has put any
   * of it on this bill yet. One word is true of both, and it is the answer to "how many": none.
   */
  'qty.notOrdered': 'Nothing',

  // --- the trade's own words for machine values ------------------------------------------------------
  'word.planned': 'Planned',
  'word.loading': 'Being loaded',
  'word.active': 'On the road',
  'word.closing': 'Checked in',
  'word.settled': 'Closed',
  'word.settled_with_variance': 'Closed with a difference',
  'word.cancelled': 'Cancelled',
  'word.pending': 'Not started',
  'word.started': 'On the way',
  'word.arrived': 'At the shop',
  'word.delivered': 'Delivered',
  'word.partial': 'Part delivered',
  'word.failed': 'Not delivered',
  'word.skipped': 'Skipped',
  'word.shop_closed': 'Shop was shut',
  'word.refused': 'Shop refused it',
  'word.no_cash': 'Shop had no money',
  'word.wrong_address': 'Wrong address',
  'word.damaged_goods': 'Goods were damaged',
  'word.other': 'Something else',
  'word.short_loaded': 'Not loaded on the van',
  'word.expired': 'Past its date',
  'word.wrong_item': 'Wrong item',
  'word.damaged': 'Damaged',
  'word.cash': 'Cash',
  'word.upi': 'UPI',
  'word.cheque': 'Cheque',
  'word.diesel': 'Diesel',
  'word.toll': 'Toll',
  'word.parking': 'Parking',
  'word.loading_expense': 'Loading charges',
  'word.food': 'Food',
  'word.repair': 'Repair',
  /* `PaymentTermsSchema` is `PRE | ON | POST_FULFILLMENT` — the enum's own three values, not the
     three words a reader would guess. A chip drew `word.ON` on the stop for Friends Corner Stores
     because this catalogue had invented `ON_DELIVERY` and `ADVANCE` instead. */
  'word.PRE': 'Paid in advance',
  'word.ON': 'Pays on delivery',
  'word.POST_FULFILLMENT': 'Credit',
  'word.sending': 'Sending',
  'word.photo': 'Photo',
  'word.signature': 'Signature',
  'word.otp': 'OTP',
  /* DOS-070: the same claim named the same way wherever a proof row is listed. */
  'word.geo': 'Arrival point',
} as const
