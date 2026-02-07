# OrbitMM Ethics & Guidelines

## The Philosophy

> "The goal is transparency, not extraction."

OrbitMM exists because tools like it already exist — in private hands, used to exploit retail traders. By open-sourcing market making capabilities, we:

1. **Level the playing field** — No more insider advantage
2. **Enable defense** — Can't defend against what you don't understand
3. **Encourage disclosure** — Transparency features make honest use easy
4. **Educate the market** — Knowledge is the best protection

---

## The Spectrum of Use

### 🟢 Clearly Ethical

**Legitimate Liquidity Provision**
- You're launching a real project with real utility
- Early trading activity bootstraps discovery
- You plan to disclose volume assistance to your community
- Funds stay in the ecosystem (not extracted)

**Testing & Development**
- Testing trading systems before production
- Stress testing your own contracts
- Educational demonstrations
- Research into market dynamics

**Defense & Detection**
- Building tools to identify manipulation
- Analyzing suspicious activity
- Protecting your community from bad actors

### 🟡 Gray Area

**Undisclosed Liquidity Support**
- Real project, real utility
- Volume assistance not disclosed
- No extraction, funds recycled
- *Question: Is non-disclosure harmful if no extraction?*

**Competitive Visibility**
- Your project is legitimate
- Competitors use these tools
- You use them to stay visible
- *Question: Is it wrong to play by the current rules?*

### 🔴 Clearly Unethical

**Pump and Dump**
- Create fake demand
- Extract capital from buyers
- Abandon project
- *This is fraud. Don't do it.*

**Rug Pull Support**
- Assist scam projects
- Create false legitimacy
- Enable theft
- *This harms real people.*

**Market Manipulation for Extraction**
- Artificial price inflation
- Coordinated with insider selling
- Retail left holding bags
- *This is why crypto has a bad reputation.*

---

## The Transparency Principle

We include a transparency module for a reason:

```typescript
// Opt-in transaction marking
transparency.markTransaction(tx, {
  tool: 'orbitMM',
  purpose: 'liquidity_bootstrap',
  project: 'MyProject',
});
```

**Why use it?**
- Builds trust with your community
- Differentiates from bad actors
- Creates accountability
- Sets industry standard

**The test:** If you're not willing to disclose it, ask yourself why. If the answer involves deceiving people, reconsider.

---

## Community Standards

### We Encourage

✅ Open discussion of market dynamics
✅ Sharing detection techniques
✅ Improving the codebase
✅ Educational content
✅ Honest disclosure of tool usage

### We Discourage

❌ Sharing "alpha" on scam coins
❌ Targeting specific projects maliciously
❌ Bragging about extraction
❌ Helping known bad actors

### We Will Not

🚫 Provide support for fraud
🚫 Add features designed purely for extraction
🚫 Protect users engaged in obvious scams

---

## Legal Considerations

**This is not legal advice.** Laws vary by jurisdiction. Consider:

- **Securities laws** — Token manipulation may violate securities regulations
- **Fraud statutes** — Deceiving investors is illegal in most places
- **Terms of service** — Exchanges may prohibit automated trading
- **Tax implications** — Trading activity has tax consequences

**Our stance:** We provide tools. You're responsible for how you use them.

---

## The Long Game

The crypto ecosystem's reputation affects everyone in it. Short-term extraction by bad actors:
- Drives away mainstream adoption
- Invites regulatory crackdowns
- Destroys trust in legitimate projects
- Makes everyone's tokens worth less

**Building trust > extracting value**

When you use these tools ethically, you're not just protecting yourself — you're contributing to an ecosystem where crypto can actually fulfill its promise.

---

## Reporting Misuse

If you see OrbitMM being used for clear fraud:
1. Document the evidence
2. Report to relevant platforms (exchanges, DexScreener)
3. Share detection findings with the community
4. Consider the human impact before public callouts

We're not the police, but we can make detection easier.

---

## Final Thoughts

The existence of these tools isn't the problem — it's the asymmetry. When only insiders have access, they exploit everyone else. When everyone has access:

- The advantage disappears
- Markets become more efficient
- Detection becomes possible
- Bad actors lose their edge

**Use these tools to build, not to burn.**

---

*"With great power comes great responsibility."*
*— Uncle Ben, probably talking about market making tools*
