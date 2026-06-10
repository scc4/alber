// Chama a Edge Function fix-answer-hashes para o usuário alice
const SUPABASE_URL = 'https://cxknwpvnabfetcsaengv.supabase.co'
const ANON_KEY     = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN4a253cHZuYWJmZXRjc2Flbmd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1OTY4NDYsImV4cCI6MjA5NTE3Mjg0Nn0.Pios1ke-j3-aH_F1-Fh57Bd9OmuvbP38xs7cMNobx8Y'
const USER_ID      = 'be86e96b-b0b9-46b3-b76e-8df670144455'

const res = await fetch(`${SUPABASE_URL}/functions/v1/fix-answer-hashes`, {
  method: 'POST',
  headers: {
    'Content-Type':  'application/json',
    'apikey':        ANON_KEY,
    'Authorization': `Bearer ${ANON_KEY}`,
  },
  body: JSON.stringify({ user_id: USER_ID }),
})

const data = await res.json()
console.log('Status:', res.status)
console.log(JSON.stringify(data, null, 2))
