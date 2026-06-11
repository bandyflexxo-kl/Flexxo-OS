/**
 * zIndex.ts — Single source of truth for ALL z-index values in the app.
 *
 * G-1 requirement: No component may use a hardcoded z-index value outside
 * this file. Run `grep -r "z-\[" src/` and `grep -r "z-index:" src/` —
 * both must return 0 results outside this file.
 *
 * Layer scale:
 *   0–9   : Base page content (relative positioning, stacking within components)
 *   10–19 : In-section decorative content (heroes, cards)
 *   20–29 : Persistent banners (promo, announcement)
 *   30–39 : Navigation headers (sticky top)
 *   40–49 : Bottom navigation (mobile)
 *   50–59 : Floating UI (search dropdowns, tooltips)
 *   60–69 : Sticky action bars (mobile add-to-cart, floating CTA)
 *   70–79 : Floating contact / WhatsApp button
 *   80–89 : Offline / status banners
 *  100–199: Drawers and sidebars
 *  200–299: Modals and dialogs
 *  300–399: Toast notifications
 *  400+   : Full-screen overlays (lightbox, loading screen)
 */

export const Z = {
  // Page content
  heroContent:    10,   // HeroSection inner relative z (decorative circles etc.)

  // Banners
  promoBanner:    20,   // Dismissible promo banner above the nav

  // Navigation
  stickyNav:      30,   // ShopNav / sticky header
  bottomNav:      40,   // ShopBottomNav (mobile fixed bottom)

  // Floating UI
  searchDropdown: 50,   // Autocomplete/search dropdown in product list
  tooltip:        55,   // Tooltips

  // Sticky action bars
  stickyCart:     60,   // StickyCartBar (mobile product detail, above bottomNav)

  // Floating buttons
  whatsappBtn:    70,   // Floating WhatsApp contact button

  // Status banners
  offlineBanner:  80,   // Offline / connectivity warning banner

  // CRM mobile chrome
  crmTopbar:     35,    // Mobile CRM top bar (hamburger + brand)
  crmBackdrop:   100,   // Backdrop overlay behind mobile CRM drawer
  crmDrawer:     110,   // Mobile CRM sidebar drawer (above backdrop)

  // Drawers
  drawer:        100,   // Side drawers (shop/generic)

  // Modals
  modalBackdrop: 200,   // Modal backdrop overlay
  modal:         210,   // Modal panel (above backdrop)

  // Toasts
  toast:         300,   // Toast notification (always on top of UI)

  // Full-screen overlays
  overlay:       400,   // Full-screen blocking overlay (e.g. page loader)
} as const

export type ZKey = keyof typeof Z
