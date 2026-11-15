// S.R. Developers CRM — simple, client-side EMI estimator.
(() => {
  const $ = id => document.getElementById(id);
  const form = $('emiForm');
  if (!form) return;
  const money = n => '₹' + Math.round(n).toLocaleString('en-IN');
  function calculate(e) {
    if (e) e.preventDefault();
    const property = Number($('emiPrincipal').value || 0);
    const down = Number($('emiDown').value || 0);
    const annual = Number($('emiRate').value || 0);
    const years = Number($('emiYears').value || 0);
    const principal = property - down;
    if (property <= 0 || down < 0 || principal <= 0 || annual < 0 || annual > 40 || years < 1 || years > 40) {
      $('emiResult').innerHTML = '<b>कृपया सही Property Amount, Down Payment, ब्याज दर और अवधि भरें।</b>';
      return;
    }
    const months = years * 12;
    const rate = annual / 1200;
    const emi = rate === 0 ? principal / months : principal * rate * Math.pow(1 + rate, months) / (Math.pow(1 + rate, months) - 1);
    const total = emi * months;
    const interest = total - principal;
    $('emiResult').innerHTML = '<b>अनुमानित EMI: ' + money(emi) + ' / माह</b><small>Loan Amount: ' + money(principal) + ' · कुल भुगतान: ' + money(total) + ' · कुल ब्याज: ' + money(interest) + ' · Down Payment: ' + money(down) + '</small>';
  }
  form.addEventListener('submit', calculate);
  ['emiPrincipal','emiDown','emiRate','emiYears'].forEach(id => $(id).addEventListener('input', calculate));
  calculate();
  const search = $('inventorySearch'), status = $('inventoryStatusFilter');
  if (search) search.addEventListener('input', () => window.srRender && window.srRender());
  if (status) status.addEventListener('change', () => window.srRender && window.srRender());
})();
