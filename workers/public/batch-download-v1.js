// Progressive enhancement for the album selection form. It creates a ZIP in
// the viewer's browser and fetches only existing authenticated derived-download
// routes, keeping Workers free of archive assembly and image processing.
import {
  createStoredZip,
  readResponseBytes,
  uniqueZipEntryFilename,
  zipEntryFilename,
} from '/zip-store-v1.js'

var MAX_FILES = 20
var MAX_FILE_BYTES = 25 * 1024 * 1024
var MAX_ARCHIVE_BYTES = 100 * 1024 * 1024

function genericFailure(status) {
  status.textContent = 'まとめて保存を完了できませんでした。リンク一覧で保存してください。'
}

function selectedPhotoIds(form) {
  return Array.prototype.slice.call(form.querySelectorAll('input[name="photoId"]'))
    .filter(function (input) { return input.checked })
    .map(function (input) { return input.value })
}

function variantFrom(form) {
  var select = form.querySelector('select[name="variant"]')
  return select && (select.value === 'thumb' || select.value === 'preview') ? select.value : null
}

function expectedContentType(variant) {
  return variant === 'thumb' ? 'image/webp' : 'image/jpeg'
}

function extensionFor(variant) {
  return variant === 'thumb' ? '.webp' : '.jpg'
}

function initialize() {
  var form = document.querySelector('.selection-form[data-batch-download-base]')
  var bar = form ? form.querySelector('.selection-bar') : null
  if (!form || !bar || typeof window.fetch !== 'function' || !window.URL || !window.URL.createObjectURL) return

  var base = form.getAttribute('data-batch-download-base')
  if (!base || !/^\/download\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(base)) return

  var button = document.createElement('button')
  button.type = 'button'
  button.className = 'selection-batch-download'
  button.textContent = 'まとめて保存 (ZIP)'

  var status = document.createElement('span')
  status.className = 'selection-zip-status'
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'polite')

  bar.appendChild(button)
  bar.appendChild(status)

  var busy = false

  function updateAvailability() {
    if (busy) return
    var count = selectedPhotoIds(form).length
    button.disabled = count === 0 || count > MAX_FILES
    if (count > MAX_FILES) {
      status.textContent = `まとめて保存は${MAX_FILES}枚までです。リンク一覧は最大100枚まで表示できます。`
    } else {
      status.textContent = ''
    }
  }

  form.addEventListener('change', updateAvailability)

  button.addEventListener('click', async function () {
    if (busy) return
    var photoIds = selectedPhotoIds(form)
    var variant = variantFrom(form)
    if (photoIds.length === 0 || photoIds.length > MAX_FILES || variant === null) {
      updateAvailability()
      return
    }

    busy = true
    button.disabled = true
    var originalButtonText = button.textContent
    var usedNames = new Set()
    var entries = []
    var totalBytes = 0
    var completed = false
    try {
      for (var index = 0; index < photoIds.length; index += 1) {
        button.textContent = `取得中 ${index + 1}/${photoIds.length}`
        status.textContent = '通信量に応じて完了まで時間がかかることがあります。'
        var remaining = MAX_ARCHIVE_BYTES - totalBytes
        if (remaining < 1) throw new Error('archive size limit reached')
        var response = await window.fetch(
          `${base}/${variant}/${encodeURIComponent(photoIds[index])}`,
          { credentials: 'same-origin', cache: 'no-store', redirect: 'error' },
        )
        if (!response.ok || response.headers.get('content-type') !== expectedContentType(variant)) {
          throw new Error('download request failed')
        }
        var bytes = await readResponseBytes(response, Math.min(MAX_FILE_BYTES, remaining))
        totalBytes += bytes.byteLength
        var name = zipEntryFilename(
          response.headers.get('content-disposition'),
          index + 1,
          extensionFor(variant),
        )
        entries.push({ name: uniqueZipEntryFilename(name, usedNames), data: bytes })
      }

      button.textContent = 'ZIPを作成中'
      var archive = createStoredZip(entries)
      var archiveUrl = window.URL.createObjectURL(archive)
      var link = document.createElement('a')
      link.href = archiveUrl
      link.download = 'photo-gate-download.zip'
      link.hidden = true
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(function () { window.URL.revokeObjectURL(archiveUrl) }, 60 * 1000)
      status.textContent = `${entries.length}枚をZIPで保存しました。`
      completed = true
    } catch (_) {
      genericFailure(status)
    } finally {
      busy = false
      button.textContent = originalButtonText
      updateAvailability()
      if (completed) status.textContent = `${entries.length}枚をZIPで保存しました。`
    }
  })

  updateAvailability()
}

initialize()
