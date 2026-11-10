import { useCallback, useEffect, useRef, useState } from 'react'

const MAX_REASON = 500
const FILTERS = ['ALL', 'PENDING', 'CONFIRMED', 'REJECTED']
const PAGE_SIZE = 10

const money = (value) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value || 0)
const shortId = (id) => id.slice(-6).toUpperCase()
const dateTime = (value) => (value ? new Date(value).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }) : '—')
const customerLabel = (order) => order.customer?.name || order.customer?.email || 'Unknown customer'

function StatusBadge({ status }) {
  return <span className={`status status-${status.toLowerCase()}`}>{status}</span>
}

function Modal({ title, children, onClose, wide = false }) {
  return (
    <div className="overlay overlay-center overlay-top" onClick={onClose}>
      <div className={`modal${wide ? ' modal-wide' : ''}`} onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <button className="icon-button modal-close" type="button" onClick={onClose} aria-label="Close">×</button>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}

function OrderDetails({ order, onClose }) {
  return (
    <Modal title={`Order #${shortId(order._id)}`} onClose={onClose} wide>
      <dl className="detail-grid">
        <div><dt>Order ID</dt><dd className="mono">{order._id}</dd></div>
        <div><dt>Placed</dt><dd>{dateTime(order.createdAt)}</dd></div>
        <div><dt>Customer</dt><dd>{order.customer ? `${order.customer.name || '—'} (${order.customer.email || 'no email'})` : 'Unknown customer'}</dd></div>
        <div><dt>Status</dt><dd><StatusBadge status={order.status} /></dd></div>
      </dl>
      <table className="admin-table detail-items">
        <thead><tr><th>Product</th><th className="num">Price</th><th className="num">Qty</th><th className="num">Subtotal</th></tr></thead>
        <tbody>
          {order.items.map((item) => (
            <tr key={item._id || item.productId}>
              <td>{item.name}</td><td className="num">{money(item.price)}</td><td className="num">{item.quantity}</td><td className="num">{money(item.price * item.quantity)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan="3">Total</td><td className="num"><strong>{money(order.total)}</strong></td></tr></tfoot>
      </table>
      {order.status === 'REJECTED' && (
        <div className="reason-box"><strong>Reason for rejection</strong><p>{order.rejectionReason}</p><small>{dateTime(order.rejectedAt)}{order.rejectedBy?.email ? ` by ${order.rejectedBy.email}` : ''}</small></div>
      )}
      {order.status === 'CONFIRMED' && order.confirmedAt && <p className="muted">Confirmed {dateTime(order.confirmedAt)}{order.confirmedBy?.email ? ` by ${order.confirmedBy.email}` : ''}.</p>}
      {order.statusHistory?.length > 0 && (
        <ul className="history">
          {order.statusHistory.map((entry, index) => <li key={index}><StatusBadge status={entry.status} /> {dateTime(entry.at)}{entry.by?.email ? ` · ${entry.by.email}` : ''}</li>)}
        </ul>
      )}
    </Modal>
  )
}

function ConfirmAccept({ order, busy, onConfirm, onClose }) {
  return (
    <Modal title="Accept this order?" onClose={busy ? () => {} : onClose}>
      <p className="muted">Order #{shortId(order._id)} for {money(order.total)} will be marked CONFIRMED.</p>
      <div className="modal-actions">
        <button className="btn btn-ghost" type="button" disabled={busy} onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" type="button" disabled={busy} onClick={onConfirm}>{busy ? 'Accepting…' : 'Accept order'}</button>
      </div>
    </Modal>
  )
}

function RejectDialog({ order, busy, error, onSubmit, onClose }) {
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)
  const trimmed = reason.trim()
  const valid = trimmed.length > 0 && trimmed.length <= MAX_REASON

  return (
    <Modal title="Decline order" onClose={busy ? () => {} : onClose}>
      <p className="muted">Order <strong>#{shortId(order._id)}</strong> ({money(order.total)}). The reason is stored with the order and shown to administrators.</p>
      {!confirming ? (
        <form onSubmit={(event) => { event.preventDefault(); if (valid) setConfirming(true) }}>
          <label>Reason for rejection
            <textarea className="reason-input" rows="4" maxLength={MAX_REASON} value={reason} autoFocus onChange={(event) => setReason(event.target.value)} placeholder="e.g. The requested product is currently unavailable." />
          </label>
          <small className="muted counter">{reason.length}/{MAX_REASON}</small>
          <div className="modal-actions">
            <button className="btn btn-ghost" type="button" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" type="submit" disabled={!valid || busy}>Continue</button>
          </div>
        </form>
      ) : (
        <>
          <div className="reason-box"><strong>Reason</strong><p>{trimmed}</p></div>
          <p>Decline this order? This cannot be undone.</p>
          {error && <p className="inline-error" role="alert">{error}</p>}
          <div className="modal-actions">
            <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => setConfirming(false)}>Back</button>
            <button className="btn btn-primary btn-reject" type="button" disabled={!valid || busy} onClick={() => onSubmit(trimmed)}>{busy ? 'Declining…' : 'Confirm decline'}</button>
          </div>
        </>
      )}
    </Modal>
  )
}

export default function AdminDashboard({ apiUrl, token, onExpired, notify }) {
  const [stats, setStats] = useState(null)
  const [data, setData] = useState({ orders: [], total: 0, pages: 1 })
  const [status, setStatus] = useState('ALL')
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const [sort, setSort] = useState('desc')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [details, setDetails] = useState(null)
  const [accepting, setAccepting] = useState(null)
  const [rejecting, setRejecting] = useState(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  // Keep the latest callback without making `request` change on every parent render.
  const expiredRef = useRef(onExpired)
  useEffect(() => { expiredRef.current = onExpired }, [onExpired])

  const request = useCallback(async (path, options = {}) => {
    const response = await fetch(`${apiUrl}/api/orders${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    })
    const result = await response.json().catch(() => ({}))
    if (response.status === 401) { expiredRef.current(); throw new Error('Session expired.') }
    if (!response.ok) throw new Error(result.error || 'The request failed.')
    return result
  }, [apiUrl, token])

  useEffect(() => {
    const timer = setTimeout(() => { setTerm(search.trim()); setPage(1) }, 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams({ status, sort, page, limit: PAGE_SIZE })
        if (term) params.set('q', term)
        const [list, summary] = await Promise.all([request(`/manage?${params}`), request('/stats')])
        if (cancelled) return
        setData(list)
        setStats(summary)
      } catch (requestError) {
        if (!cancelled) setError(requestError.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [request, status, sort, page, term, reload])

  async function accept(order) {
    setBusy(true)
    try {
      await request(`/${order._id}/accept`, { method: 'PATCH' })
      notify('success', `Order #${shortId(order._id)} accepted.`)
      setAccepting(null)
    } catch (requestError) {
      notify('error', requestError.message)
      setAccepting(null)
    } finally {
      setBusy(false)
      setReload((value) => value + 1)
    }
  }

  async function reject(order, reason) {
    setBusy(true)
    setActionError('')
    try {
      await request(`/${order._id}/reject`, { method: 'PATCH', body: JSON.stringify({ reason }) })
      notify('success', `Order #${shortId(order._id)} declined.`)
      setRejecting(null)
      setReload((value) => value + 1)
    } catch (requestError) {
      setActionError(requestError.message)
      setReload((value) => value + 1)
    } finally {
      setBusy(false)
    }
  }

  const cards = [
    ['Total orders', stats?.total],
    ['Pending', stats?.pending],
    ['Confirmed', stats?.confirmed],
    ['Rejected', stats?.rejected],
  ]

  return (
    <section className="section container admin-dashboard">
      <div className="section-head">
        <h2>Order dashboard</h2>
        <button className="btn btn-ghost btn-small" type="button" onClick={() => setReload((value) => value + 1)}>Refresh</button>
      </div>

      <div className="stat-grid">
        {cards.map(([label, value]) => (
          <div className="stat-card" key={label}><span>{label}</span><strong>{value ?? '—'}</strong></div>
        ))}
        <div className="stat-card"><span>Confirmed sales</span><strong>{stats ? money(stats.confirmedValue) : '—'}</strong></div>
      </div>

      <div className="admin-toolbar">
        <div className="filter-tabs" role="tablist" aria-label="Filter by status">
          {FILTERS.map((value) => (
            <button key={value} type="button" role="tab" aria-selected={status === value} className={`chip${status === value ? ' chip-active' : ''}`} onClick={() => { setStatus(value); setPage(1) }}>{value}</button>
          ))}
        </div>
        <input className="toolbar-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search order ID, name or email" aria-label="Search orders" />
      </div>

      {error ? (
        <div className="inline-error" role="alert">{error} <button className="link-inline" type="button" onClick={() => setReload((value) => value + 1)}>Retry</button></div>
      ) : loading && data.orders.length === 0 ? (
        <div className="empty">Loading orders…</div>
      ) : data.orders.length === 0 ? (
        <div className="empty">No orders match these filters.</div>
      ) : (
        <div className={`table-wrap${loading ? ' is-loading' : ''}`}>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Order</th><th>Customer</th><th>Items</th><th className="num">Total</th>
                <th><button className="sort-button" type="button" onClick={() => { setSort(sort === 'desc' ? 'asc' : 'desc'); setPage(1) }}>Date {sort === 'desc' ? '↓' : '↑'}</button></th>
                <th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.orders.map((order) => (
                <tr key={order._id}>
                  <td className="mono">#{shortId(order._id)}</td>
                  <td>{customerLabel(order)}{order.customer?.email && order.customer.name ? <small className="block muted">{order.customer.email}</small> : null}</td>
                  <td>{order.items.map((item) => `${item.quantity} × ${item.name}`).join(', ')}</td>
                  <td className="num">{money(order.total)}</td>
                  <td>{dateTime(order.createdAt)}</td>
                  <td>
                    <StatusBadge status={order.status} />
                    {order.status === 'REJECTED' && order.rejectionReason && <small className="block muted reason-cell">{order.rejectionReason}</small>}
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn btn-ghost btn-small" type="button" onClick={() => setDetails(order)}>Details</button>
                      {order.status === 'PENDING' && (
                        <>
                          <button className="btn btn-primary btn-small" type="button" onClick={() => setAccepting(order)}>Accept</button>
                          <button className="btn btn-ghost btn-small btn-danger" type="button" onClick={() => { setActionError(''); setRejecting(order) }}>Decline</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.pages > 1 && (
        <div className="pager">
          <button className="btn btn-ghost btn-small" type="button" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
          <span className="muted">Page {page} of {data.pages} · {data.total} orders</span>
          <button className="btn btn-ghost btn-small" type="button" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}

      {details && <OrderDetails order={details} onClose={() => setDetails(null)} />}
      {accepting && <ConfirmAccept order={accepting} busy={busy} onConfirm={() => accept(accepting)} onClose={() => setAccepting(null)} />}
      {rejecting && <RejectDialog order={rejecting} busy={busy} error={actionError} onSubmit={(reason) => reject(rejecting, reason)} onClose={() => setRejecting(null)} />}
    </section>
  )
}
