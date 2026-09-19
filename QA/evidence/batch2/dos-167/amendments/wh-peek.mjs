import { pull, sql } from './wh-pull.mjs'
const local = pull('wf134ugk70jtqq43yzvsimplap7r431bgsoifpg41eqordf44xk', 'wh-peek')
console.log('tables:', sql(local, '.tables').replace(/\s+/g, ' '))
console.log('picklists:', sql(local, 'select id,picklist_no,status from picklists'))
console.log('pick_lines count:', sql(local, 'select count(*) from pick_lines'))
console.log('todo lines:', sql(local, "select id,line_no,requested_qty_pcs,picked_qty_pcs from pick_lines where picked_qty_pcs=0 and short_reason is null order by line_no"))
console.log('outbox:', sql(local, 'select seq,op_id,row_id,status,attempts from _outbox order by seq'))
console.log('sync_state:', sql(local, "select key,value from _sync_state where key in ('userId','role','lastPulledAt','lastUploadAt')"))
