// Progressive enhancement only. See docs/decisions/2026-07-03-ui-redesign.md
// section 2.2: every feature here enhances an already-working HTML mechanism,
// and every page remains fully functional with this script disabled.
// Vanilla ES2020, no dependencies, no build step. Feature-detects its hooks so
// it is safe to load, unmodified, on every page.
(function () {
  'use strict'

  function isEditableTarget(target) {
    if (!target || typeof target.closest !== 'function') return false
    return Boolean(target.closest('input, select, textarea, [contenteditable="true"]'))
  }

  function initPreviewNav() {
    var prevLink = document.querySelector('[data-nav="prev"]')
    var nextLink = document.querySelector('[data-nav="next"]')
    if (!prevLink && !nextLink) return

    function go(link) {
      if (link) window.location.href = link.href
    }

    document.addEventListener('keydown', function (e) {
      if (e.defaultPrevented) return
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return
      if (isEditableTarget(e.target)) return
      if (e.key === 'ArrowLeft') go(prevLink)
      else if (e.key === 'ArrowRight') go(nextLink)
    })

    var startX = 0
    var startY = 0
    var tracking = false
    var SWIPE_THRESHOLD = 48

    document.addEventListener(
      'touchstart',
      function (e) {
        var touch = e.touches[0]
        if (!touch) return
        var target = touch.target
        if (target && target.closest && target.closest('a, button, details')) {
          tracking = false
          return
        }
        startX = touch.clientX
        startY = touch.clientY
        tracking = true
      },
      { passive: true },
    )

    document.addEventListener(
      'touchend',
      function (e) {
        if (!tracking) return
        tracking = false
        var touch = e.changedTouches[0]
        if (!touch) return
        var dx = touch.clientX - startX
        var dy = touch.clientY - startY
        if (Math.abs(dy) > Math.abs(dx)) return
        if (Math.abs(dx) < SWIPE_THRESHOLD) return
        go(dx < 0 ? nextLink : prevLink)
      },
      { passive: true },
    )
  }

  function initSelectionBar() {
    var form = document.querySelector('.selection-form')
    var bar = form ? form.querySelector('.selection-bar') : null
    if (!form || !bar) return

    function checkboxes() {
      return Array.prototype.slice.call(form.querySelectorAll('input[name="photoId"]'))
    }

    var count = document.createElement('span')
    count.className = 'selection-count-live'

    var selectAll = document.createElement('button')
    selectAll.type = 'button'
    selectAll.className = 'selection-select-all'
    selectAll.textContent = '全選択'

    var clear = document.createElement('button')
    clear.type = 'button'
    clear.className = 'selection-clear'
    clear.textContent = '解除'

    var firstChild = bar.firstChild
    bar.insertBefore(count, firstChild)
    bar.insertBefore(selectAll, firstChild)
    bar.insertBefore(clear, firstChild)

    function updateCount() {
      var checked = checkboxes().filter(function (cb) {
        return cb.checked
      }).length
      count.textContent = checked + '枚選択中'
    }

    form.addEventListener('change', function (e) {
      if (e.target && e.target.name === 'photoId') updateCount()
    })

    selectAll.addEventListener('click', function () {
      checkboxes().forEach(function (cb) {
        cb.checked = true
      })
      updateCount()
    })

    clear.addEventListener('click', function () {
      checkboxes().forEach(function (cb) {
        cb.checked = false
      })
      updateCount()
    })

    updateCount()
  }

  initPreviewNav()
  initSelectionBar()
})()
