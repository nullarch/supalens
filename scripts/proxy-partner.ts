/**
 * Proxy-gateway partner ops (v1 — no admin UI).
 *
 * Usage (env must carry NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY):
 *   npx tsx --env-file=.env.local scripts/proxy-partner.ts <command> [...args]
 *
 * Commands:
 *   create <name> <code> [--test]          mint a partner + api key/secret (printed ONCE)
 *   rotate-key <code>                      current key → api_key_previous, mint new current
 *   clear-previous <code>                  end the rotation window (old key stops working)
 *   set-callback <code> <url>              set the signed-callback URL
 *   add-origin <code> <origin>             allow a success/fail redirect origin (exact match)
 *   add-product <code> <sku> <paddle_price_id>   map a partner SKU to a Paddle catalog price
 *   deactivate <code> | activate <code>
 *   list                                   partners + products overview (no secrets)
 */
import { randomBytes } from 'node:crypto'

import { requireAdminClient } from '../src/utils/supabase/admin'

const admin = requireAdminClient()

async function partnerByCode(code: string) {
  const { data, error } = await admin.from('proxy_partners').select('*').eq('code', code).limit(1)
  if (error) throw error
  const partner = data?.[0]
  if (!partner) throw new Error(`no partner with code '${code}'`)
  return partner as { id: string; code: string; is_test: boolean }
}

function mintKey(isTest: boolean): string {
  return `${isTest ? 'pk_test_' : 'pk_live_'}${randomBytes(24).toString('base64url')}`
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2)

  switch (cmd) {
    case 'create': {
      const [name, code] = args
      const isTest = args.includes('--test')
      if (!name || !code) throw new Error('usage: create <name> <code> [--test]')
      if (!/^[a-z0-9_]{2,32}$/.test(code)) throw new Error('code must be 2-32 chars of [a-z0-9_]')
      const apiKey = mintKey(isTest)
      const apiSecret = randomBytes(32).toString('hex')
      const { error } = await admin
        .from('proxy_partners')
        .insert({ name, code, api_key: apiKey, api_secret: apiSecret, is_test: isTest })
      if (error) throw error
      console.log(`partner '${code}' created (${isTest ? 'TEST' : 'LIVE'})`)
      console.log('')
      console.log('  Deliver these to the partner over a safe channel — shown ONCE, not retrievable:')
      console.log(`  API key:    ${apiKey}`)
      console.log(`  API secret: ${apiSecret}`)
      break
    }
    case 'rotate-key': {
      const partner = await partnerByCode(args[0])
      const apiKey = mintKey(partner.is_test)
      const { data: cur } = await admin.from('proxy_partners').select('api_key').eq('id', partner.id).limit(1)
      const { error } = await admin
        .from('proxy_partners')
        .update({ api_key: apiKey, api_key_previous: (cur?.[0] as { api_key: string }).api_key })
        .eq('id', partner.id)
      if (error) throw error
      console.log(`new API key (old key keeps working until clear-previous): ${apiKey}`)
      break
    }
    case 'clear-previous': {
      const partner = await partnerByCode(args[0])
      const { error } = await admin.from('proxy_partners').update({ api_key_previous: null }).eq('id', partner.id)
      if (error) throw error
      console.log('rotation window closed')
      break
    }
    case 'set-callback': {
      const partner = await partnerByCode(args[0])
      const url = args[1]
      if (!url) throw new Error('usage: set-callback <code> <url>')
      new URL(url) // validate
      const { error } = await admin.from('proxy_partners').update({ callback_url: url }).eq('id', partner.id)
      if (error) throw error
      console.log(`callback_url = ${url}`)
      break
    }
    case 'add-origin': {
      const partner = await partnerByCode(args[0])
      const origin = args[1]
      if (!origin || new URL(origin).origin !== origin) throw new Error('pass an exact origin, e.g. https://partner.example')
      const { data } = await admin.from('proxy_partners').select('allowed_origins').eq('id', partner.id).limit(1)
      const origins: string[] = (data?.[0] as { allowed_origins: string[] }).allowed_origins ?? []
      if (!origins.includes(origin)) origins.push(origin)
      const { error } = await admin.from('proxy_partners').update({ allowed_origins: origins }).eq('id', partner.id)
      if (error) throw error
      console.log(`allowed_origins = ${origins.join(', ')}`)
      break
    }
    case 'add-product': {
      const partner = await partnerByCode(args[0])
      const [, sku, priceId] = args
      if (!sku || !priceId) throw new Error('usage: add-product <code> <sku> <paddle_price_id>')
      const { error } = await admin
        .from('proxy_products')
        .insert({ partner_id: partner.id, sku, paddle_price_id: priceId })
      if (error) throw error
      console.log(`product '${sku}' → ${priceId}`)
      break
    }
    case 'deactivate':
    case 'activate': {
      const partner = await partnerByCode(args[0])
      const { error } = await admin
        .from('proxy_partners')
        .update({ is_active: cmd === 'activate' })
        .eq('id', partner.id)
      if (error) throw error
      console.log(`partner '${partner.code}' ${cmd}d`)
      break
    }
    case 'list': {
      const { data: partners } = await admin
        .from('proxy_partners')
        .select('id, name, code, is_test, is_active, callback_url, allowed_origins, created_at')
        .order('created_at')
      for (const p of (partners ?? []) as Array<Record<string, unknown>>) {
        console.log(
          `${p.code} — ${p.name} [${p.is_test ? 'TEST' : 'LIVE'}${p.is_active ? '' : ', INACTIVE'}] callback=${p.callback_url ?? '-'} origins=${(p.allowed_origins as string[]).join(',') || '-'}`,
        )
        const { data: products } = await admin
          .from('proxy_products')
          .select('sku, paddle_price_id, kind, is_active')
          .eq('partner_id', p.id as string)
        for (const pr of (products ?? []) as Array<Record<string, unknown>>) {
          console.log(`    ${pr.sku} → ${pr.paddle_price_id} (${pr.kind}${pr.is_active ? '' : ', inactive'})`)
        }
      }
      break
    }
    default:
      throw new Error(`unknown command '${cmd ?? ''}' — see the header of this file for usage`)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
