import { useEffect, useMemo, useRef, useState } from 'react'
import AdminDashboard from './AdminDashboard.jsx'
import './App.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'
const SESSION_KEY = 'minishop_session'
const CART_KEY = 'minishop_cart'

function readStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}

function formatPrice(value) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

// Redimensionne et compresse la photo dans le navigateur avant l'envoi (max 900px, JPEG).
async function fileToDataUrl(file, maxSize = 900, quality = 0.82) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.')
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', quality)
}

/* ------------------------------------------------------------------ */
/* Petits composants                                                   */
/* ------------------------------------------------------------------ */

function BagIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 7h12l1 13H5L6 7Z" />
      <path d="M9 7a3 3 0 0 1 6 0" />
    </svg>
  )
}

function ProductImage({ product, className = '' }) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [product.image])

  if (product.image && !failed) {
    return <img className={`photo ${className}`} src={product.image} alt={product.name} loading="lazy" onError={() => setFailed(true)} />
  }
  return <div className={`photo photo-placeholder ${className}`} aria-label={product.name}><span>{product.name.slice(0, 1).toUpperCase()}</span></div>
}

function ProductCard({ product, isAdmin, inCartQty, onAdd, onChangePhoto, onDelete }) {
  const soldOut = product.stock <= 0
  const limitReached = inCartQty >= product.stock

  return (
    <article className="product-card">
      <div className="product-media">
        <ProductImage product={product} />
        {soldOut && <span className="badge badge-dark">Sold out</span>}
        {!soldOut && product.stock <= 5 && <span className="badge">Only {product.stock} left</span>}
      </div>
      <div className="product-body">
        <div className="product-title">
          <h3>{product.name}</h3>
          <strong>{formatPrice(product.price)}</strong>
        </div>
        <p>{product.description || 'A considered addition to your everyday.'}</p>
        <button className="btn btn-primary btn-block" type="button" disabled={soldOut || limitReached} onClick={() => onAdd(product)}>
          {soldOut ? 'Unavailable' : limitReached ? 'Max quantity in basket' : 'Add to basket'}
        </button>
        {isAdmin && (
          <div className="admin-row">
            <label className="btn btn-ghost btn-small">
              Change photo
              <input type="file" accept="image/*" hidden onChange={(event) => { onChangePhoto(product, event.target.files[0]); event.target.value = '' }} />
            </label>
            <button className="btn btn-ghost btn-small btn-danger" type="button" onClick={() => onDelete(product)}>Delete</button>
          </div>
        )}
      </div>
    </article>
  )
}

function Toast({ toast, onClose }) {
  if (!toast) return null
  return (
    <div className={`toast toast-${toast.type}`} role="status">
      <span>{toast.text}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss message">×</button>
    </div>
  )
}

function CartDrawer({ cart, total, error, isOrdering, onClose, onChangeQuantity, onCheckout }) {
  return (
    <div className="overlay" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()} aria-label="Basket">
        <div className="drawer-head">
          <h2>Your basket</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close basket">×</button>
        </div>

        {cart.length === 0 ? (
          <div className="drawer-empty">
            <BagIcon />
            <p>Your basket is empty.</p>
            <button className="btn btn-ghost" type="button" onClick={onClose}>Continue shopping</button>
          </div>
        ) : (
          <>
            <div className="drawer-items">
              {cart.map((item) => (
                <div className="cart-item" key={item.productId}>
                  <ProductImage product={item} className="cart-thumb" />
                  <div className="cart-info">
                    <h3>{item.name}</h3>
                    <p>{formatPrice(item.price)}</p>
                    <div className="quantity">
                      <button type="button" onClick={() => onChangeQuantity(item.productId, -1)} aria-label={`Remove one ${item.name}`}>−</button>
                      <span>{item.quantity}</span>
                      <button type="button" disabled={item.quantity >= item.stock} onClick={() => onChangeQuantity(item.productId, 1)} aria-label={`Add one ${item.name}`}>+</button>
                    </div>
                  </div>
                  <strong>{formatPrice(item.price * item.quantity)}</strong>
                </div>
              ))}
            </div>
            <div className="drawer-foot">
              {error && <p className="inline-error" role="alert">{error}</p>}
              <div className="total-row"><span>Total</span><strong>{formatPrice(total)}</strong></div>
              <button className="btn btn-primary btn-block btn-large" type="button" disabled={isOrdering} onClick={onCheckout}>
                {isOrdering ? 'Placing order…' : 'Place order'}
              </button>
            </div>
          </>
        )}
      </aside>
    </div>
  )
}

function AuthModal({ mode, form, error, onChange, onSwitch, onSubmit, onClose }) {
  const isLogin = mode === 'login'
  return (
    <div className="overlay overlay-center overlay-top" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <button className="icon-button modal-close" type="button" onClick={onClose} aria-label="Close">×</button>
        <h2>{isLogin ? 'Welcome back' : 'Create your account'}</h2>
        <p className="muted">{isLogin ? 'Sign in to place your order.' : 'Join MiniShop to start ordering.'}</p>
        <form onSubmit={onSubmit}>
          {!isLogin && (
            <label>Name<input required minLength="2" value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} placeholder="Your name" /></label>
          )}
          <label>Email<input required type="email" value={form.email} onChange={(event) => onChange({ ...form, email: event.target.value })} placeholder="you@example.com" /></label>
          <label>Password<input required minLength="8" type="password" value={form.password} onChange={(event) => onChange({ ...form, password: event.target.value })} placeholder="At least 8 characters" /></label>
          {error && <p className="inline-error" role="alert">{error}</p>}
          <button className="btn btn-primary btn-block btn-large" type="submit">{isLogin ? 'Sign in' : 'Create account'}</button>
        </form>
        <button className="link-button" type="button" onClick={onSwitch}>{isLogin ? 'No account yet? Register' : 'Already registered? Sign in'}</button>
      </div>
    </div>
  )
}

function AdminModal({ form, isSaving, onChange, onPickFile, onSubmit, onClose }) {
  return (
    <div className="overlay overlay-center" onClick={onClose}>
      <div className="modal modal-wide" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <button className="icon-button modal-close" type="button" onClick={onClose} aria-label="Close">×</button>
        <h2>Add a product</h2>
        <p className="muted">Admin only — the product goes live in the catalog immediately.</p>
        <form onSubmit={onSubmit} className="admin-form">
          <div className="upload-box">
            {form.image ? <img src={form.image} alt="Preview" /> : <span>No photo yet</span>}
          </div>
          <div className="admin-fields">
            <label className="btn btn-ghost">
              Upload a photo
              <input type="file" accept="image/*" hidden onChange={(event) => { onPickFile(event.target.files[0]); event.target.value = '' }} />
            </label>
            <label>…or paste an image URL<input value={form.image.startsWith('data:') ? '' : form.image} onChange={(event) => onChange({ ...form, image: event.target.value.trim() })} placeholder="https://…" /></label>
            <label>Name<input required value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} placeholder="e.g. Field notebook" /></label>
            <label>Description<input value={form.description} onChange={(event) => onChange({ ...form, description: event.target.value })} placeholder="A short description" /></label>
            <div className="form-row">
              <label>Price (USD)<input required min="0" step="0.01" type="number" value={form.price} onChange={(event) => onChange({ ...form, price: event.target.value })} placeholder="0.00" /></label>
              <label>Stock<input required min="0" step="1" type="number" value={form.stock} onChange={(event) => onChange({ ...form, stock: event.target.value })} placeholder="0" /></label>
            </div>
            <button className="btn btn-primary btn-block btn-large" type="submit" disabled={isSaving}>{isSaving ? 'Publishing…' : 'Publish product'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Application                                                         */
/* ------------------------------------------------------------------ */

const EMPTY_PRODUCT = { name: '', description: '', price: '', stock: '', image: '' }

function App() {
  const [products, setProducts] = useState([])
  const [orders, setOrders] = useState([])
  const [cart, setCart] = useState(() => readStorage(CART_KEY, []))
  const [session, setSession] = useState(() => readStorage(SESSION_KEY, null))
  const [loading, setLoading] = useState(true)
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [toast, setToast] = useState(null)

  const [isCartOpen, setIsCartOpen] = useState(false)
  const [isAuthOpen, setIsAuthOpen] = useState(false)
  const [isAdminOpen, setIsAdminOpen] = useState(false)
  const [showDashboard, setShowDashboard] = useState(false)
  const [isOrdering, setIsOrdering] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [cartError, setCartError] = useState('')
  const [authError, setAuthError] = useState('')
  const [authMode, setAuthMode] = useState('login')
  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' })
  const [productForm, setProductForm] = useState(EMPTY_PRODUCT)
  const reopenCartAfterAuth = useRef(false)

  const isAdmin = session?.user?.role === 'ADMIN'
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0)
  const cartTotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)

  function notify(type, text) {
    setToast({ type, text, id: Date.now() })
  }

  /* --- données --------------------------------------------------- */

  async function loadProducts() {
    setLoading(true)
    try {
      const response = await fetch(`${API_URL}/api/products`)
      if (!response.ok) throw new Error('The product service could not be reached.')
      const data = await response.json()
      setProducts(data)
      // Garde le panier cohérent avec le catalogue (prix, stock, photo, produits supprimés).
      setCart((current) => current
        .map((item) => {
          const fresh = data.find((product) => product._id === item.productId)
          if (!fresh || fresh.stock <= 0) return null
          return { ...item, name: fresh.name, price: fresh.price, image: fresh.image, stock: fresh.stock, quantity: Math.min(item.quantity, fresh.stock) }
        })
        .filter(Boolean))
    } catch (requestError) {
      notify('error', requestError.message)
    } finally {
      setLoading(false)
    }
  }

  async function loadOrders() {
    setOrdersLoading(true)
    try {
      const response = await fetch(`${API_URL}/api/orders`)
      if (!response.ok) throw new Error('The order service could not be reached.')
      setOrders(await response.json())
    } catch (requestError) {
      notify('error', requestError.message)
    } finally {
      setOrdersLoading(false)
    }
  }

  useEffect(() => { loadProducts() }, [])
  useEffect(() => { if (session) loadOrders() }, [session])
  useEffect(() => { localStorage.setItem(CART_KEY, JSON.stringify(cart)) }, [cart])

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(null), 4500)
    return () => clearTimeout(timer)
  }, [toast])

  const anyOverlayOpen = isCartOpen || isAuthOpen || isAdminOpen
  useEffect(() => {
    document.body.style.overflow = anyOverlayOpen ? 'hidden' : ''
    function onKeyDown(event) {
      if (event.key !== 'Escape') return
      setIsAuthOpen(false)
      setIsAdminOpen(false)
      setIsCartOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [anyOverlayOpen])

  /* --- authentification ------------------------------------------ */

  function openAuth(mode = 'login') {
    setAuthMode(mode)
    setAuthError('')
    setIsAuthOpen(true)
  }

  async function submitAuth(event) {
    event.preventDefault()
    setAuthError('')
    try {
      const isLogin = authMode === 'login'
      const response = await fetch(`${API_URL}/api/auth/${isLogin ? 'login' : 'register'}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isLogin ? { email: authForm.email, password: authForm.password } : authForm),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Authentication failed.')
      const nextSession = { token: result.token, user: result.user }
      localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession))
      setSession(nextSession)
      setAuthForm({ name: '', email: '', password: '' })
      setIsAuthOpen(false)
      notify('success', `Welcome, ${result.user.name}.`)
      if (reopenCartAfterAuth.current) {
        reopenCartAfterAuth.current = false
        setIsCartOpen(true)
      }
    } catch (requestError) {
      setAuthError(requestError.message)
    }
  }

  function signOut(message = 'You have been signed out.') {
    localStorage.removeItem(SESSION_KEY)
    setSession(null)
    setShowDashboard(false)
    notify('success', message)
  }

  // Une session expirée (JWT de 2 h) doit renvoyer vers la connexion, pas échouer en silence.
  function handleExpiredSession() {
    localStorage.removeItem(SESSION_KEY)
    setSession(null)
    setShowDashboard(false)
    setIsCartOpen(false)
    setIsAdminOpen(false)
    reopenCartAfterAuth.current = cart.length > 0
    openAuth('login')
    notify('error', 'Your session expired. Please sign in again.')
  }

  /* --- panier ---------------------------------------------------- */

  function addToCart(product) {
    setCart((current) => {
      const existing = current.find((item) => item.productId === product._id)
      if (existing) {
        return current.map((item) => item.productId === product._id ? { ...item, quantity: Math.min(item.quantity + 1, product.stock), stock: product.stock } : item)
      }
      return [...current, { productId: product._id, name: product.name, price: product.price, image: product.image, stock: product.stock, quantity: 1 }]
    })
    notify('success', `${product.name} added to your basket.`)
  }

  function changeQuantity(productId, amount) {
    setCart((current) => current
      .map((item) => item.productId === productId ? { ...item, quantity: Math.min(item.quantity + amount, item.stock) } : item)
      .filter((item) => item.quantity > 0))
  }

  async function checkout() {
    if (cart.length === 0) return
    setCartError('')

    if (!session) {
      // Le panier doit se fermer, sinon la fenêtre de connexion s'ouvre derrière lui.
      reopenCartAfterAuth.current = true
      setIsCartOpen(false)
      openAuth('login')
      notify('error', 'Sign in before placing an order.')
      return
    }

    setIsOrdering(true)
    try {
      const response = await fetch(`${API_URL}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
        body: JSON.stringify({ items: cart.map(({ productId, quantity }) => ({ productId, quantity })) }),
      })
      const result = await response.json().catch(() => ({}))
      if (response.status === 401) return handleExpiredSession()
      if (!response.ok) throw new Error(result.error || 'The order could not be created.')
      setCart([])
      setIsCartOpen(false)
      await loadOrders()
      notify('success', `Order ${result._id.slice(-6).toUpperCase()} placed for ${formatPrice(result.total)}.`)
    } catch (requestError) {
      setCartError(requestError.message)
    } finally {
      setIsOrdering(false)
    }
  }

  /* --- administration -------------------------------------------- */

  async function pickPhotoForForm(file) {
    if (!file) return
    try {
      setProductForm((current) => ({ ...current, image: '' }))
      const image = await fileToDataUrl(file)
      setProductForm((current) => ({ ...current, image }))
    } catch (photoError) {
      notify('error', photoError.message)
    }
  }

  async function adminRequest(path, method, body) {
    const response = await fetch(`${API_URL}/api/products${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (response.status === 401) { handleExpiredSession(); return null }
    if (response.status === 204) return {}
    const result = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(result.error || 'The request failed.')
    return result
  }

  async function submitProduct(event) {
    event.preventDefault()
    if (!isAdmin) return
    setIsSaving(true)
    try {
      const result = await adminRequest('', 'POST', {
        name: productForm.name,
        description: productForm.description,
        price: Number(productForm.price),
        stock: Number(productForm.stock),
        image: productForm.image,
      })
      if (!result) return
      setProducts((current) => [result, ...current])
      setProductForm(EMPTY_PRODUCT)
      setIsAdminOpen(false)
      notify('success', `${result.name} is now live in the catalog.`)
    } catch (requestError) {
      notify('error', requestError.message)
    } finally {
      setIsSaving(false)
    }
  }

  async function changeProductPhoto(product, file) {
    if (!file) return
    try {
      const image = await fileToDataUrl(file)
      const result = await adminRequest(`/${product._id}`, 'PUT', { image })
      if (!result) return
      setProducts((current) => current.map((item) => item._id === product._id ? result : item))
      setCart((current) => current.map((item) => item.productId === product._id ? { ...item, image: result.image } : item))
      notify('success', `Photo updated for ${product.name}.`)
    } catch (requestError) {
      notify('error', requestError.message)
    }
  }

  async function deleteProduct(product) {
    if (!window.confirm(`Delete "${product.name}" from the catalog?`)) return
    try {
      const result = await adminRequest(`/${product._id}`, 'DELETE')
      if (!result) return
      setProducts((current) => current.filter((item) => item._id !== product._id))
      setCart((current) => current.filter((item) => item.productId !== product._id))
      notify('success', `${product.name} was removed.`)
    } catch (requestError) {
      notify('error', requestError.message)
    }
  }

  /* --- affichage -------------------------------------------------- */

  const visibleProducts = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return products
    return products.filter((product) => `${product.name} ${product.description}`.toLowerCase().includes(term))
  }, [products, query])

  const featured = products.find((product) => product.image) || products[0]
  const qtyInCart = (productId) => cart.find((item) => item.productId === productId)?.quantity || 0

  return (
    <div className="shop">
      <header className="header">
        <div className="container header-inner">
          <a className="logo" href="/" aria-label="MiniShop home">Mini<span>Shop</span></a>
          <label className="search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search products" aria-label="Search products" />
          </label>
          <nav className="header-actions">
            {isAdmin && <button className="btn btn-ghost btn-small" type="button" onClick={() => setShowDashboard((value) => !value)}>{showDashboard ? 'Storefront' : 'Order dashboard'}</button>}
            {isAdmin && <button className="btn btn-ghost btn-small" type="button" onClick={() => setIsAdminOpen(true)}>+ Add product</button>}
            {session ? (
              <>
                <span className="account-name">{session.user.name}{isAdmin && <b>Admin</b>}</span>
                <button className="btn btn-ghost btn-small" type="button" onClick={() => signOut()}>Sign out</button>
              </>
            ) : (
              <button className="btn btn-ghost btn-small" type="button" onClick={() => openAuth('login')}>Sign in</button>
            )}
            <button className="cart-button" type="button" onClick={() => { setCartError(''); setIsCartOpen(true) }} aria-label={`Open basket, ${cartCount} items`}>
              <BagIcon />
              {cartCount > 0 && <span className="cart-count">{cartCount}</span>}
            </button>
          </nav>
        </div>
      </header>

      <main>
        {showDashboard && isAdmin ? (
          <AdminDashboard apiUrl={API_URL} token={session.token} onExpired={handleExpiredSession} notify={notify} />
        ) : (<>
        <section className="hero">
          <div className="container hero-inner">
            <div className="hero-copy">
              <p className="kicker">New season • Curated goods</p>
              <h1>Everyday objects,<br /><em>beautifully chosen.</em></h1>
              <p className="lead">A small shop with a carefully edited catalog. Pick your favorites, fill your basket and check out in seconds.</p>
              <a className="btn btn-primary btn-large" href="#catalog">Shop the collection</a>
            </div>
            <div className="hero-visual">
              {featured ? (
                <>
                  <ProductImage product={featured} className="hero-photo" />
                  <div className="hero-tag"><span>Featured</span><strong>{featured.name}</strong><em>{formatPrice(featured.price)}</em></div>
                </>
              ) : (
                <div className="photo photo-placeholder hero-photo"><span>M</span></div>
              )}
            </div>
          </div>
        </section>

        <section id="catalog" className="section container">
          <div className="section-head">
            <h2>The collection</h2>
            <span className="muted">{visibleProducts.length} {visibleProducts.length === 1 ? 'product' : 'products'}</span>
          </div>
          {loading ? (
            <div className="product-grid">{[0, 1, 2, 3].map((index) => <div className="skeleton" key={index} />)}</div>
          ) : visibleProducts.length === 0 ? (
            <div className="empty">{products.length === 0 ? (isAdmin ? 'No products yet — use “Add product” to publish the first one.' : 'No products yet. Come back soon!') : `No product matches “${query}”.`}</div>
          ) : (
            <div className="product-grid">
              {visibleProducts.map((product) => (
                <ProductCard key={product._id} product={product} isAdmin={isAdmin} inCartQty={qtyInCart(product._id)} onAdd={addToCart} onChangePhoto={changeProductPhoto} onDelete={deleteProduct} />
              ))}
            </div>
          )}
        </section>

        {session && (
          <section id="orders" className="section container">
            <div className="section-head">
              <h2>Recent orders</h2>
              <span className="muted">{orders.length} total</span>
            </div>
            {ordersLoading ? <div className="empty">Loading orders…</div> : orders.length === 0 ? <div className="empty">No orders yet.</div> : (
              <div className="orders-grid">
                {orders.map((order) => (
                  <article className="order-card" key={order._id}>
                    <div className="order-top">
                      <strong>Order #{order._id.slice(-6).toUpperCase()}</strong>
                      <span className={`status status-${order.status.toLowerCase()}`}>{order.status}</span>
                    </div>
                    <ul>{order.items.map((item) => <li key={item._id || item.productId}>{item.quantity} × {item.name}</li>)}</ul>
                    <div className="order-bottom">
                      <time dateTime={order.createdAt}>{new Date(order.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</time>
                      <strong>{formatPrice(order.total)}</strong>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}
        </>)}
      </main>

      <footer className="footer">
        <div className="container footer-inner"><span>© 2026 MiniShop</span><span>Microservices • Docker • MongoDB</span></div>
      </footer>

      {isCartOpen && <CartDrawer cart={cart} total={cartTotal} error={cartError} isOrdering={isOrdering} onClose={() => setIsCartOpen(false)} onChangeQuantity={changeQuantity} onCheckout={checkout} />}
      {isAuthOpen && <AuthModal mode={authMode} form={authForm} error={authError} onChange={setAuthForm} onSwitch={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError('') }} onSubmit={submitAuth} onClose={() => setIsAuthOpen(false)} />}
      {isAdminOpen && isAdmin && <AdminModal form={productForm} isSaving={isSaving} onChange={setProductForm} onPickFile={pickPhotoForForm} onSubmit={submitProduct} onClose={() => setIsAdminOpen(false)} />}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  )
}

export default App
