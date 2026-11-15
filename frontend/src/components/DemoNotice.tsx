export function DemoNotice({ prepared, enabled }: { prepared?: boolean; enabled?: boolean }) {
  if (!prepared && !enabled) return null
  return <div className="rs-banner rs-banner--warn" role="note" style={{ marginBottom: 16 }}>
    <span>{prepared ? 'Prepared demo history is included. New takes use uploaded audio.' : 'Demo mode is enabled.'}</span>
  </div>
}
