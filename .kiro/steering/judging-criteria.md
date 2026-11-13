# Judging Criteria

NASA Space Apps judging has five criteria. Every design and build decision should be defensible against at least one of them.

## The Five Criteria

### 1. Impact
Does it matter? Could it help real people?

**How we win this:**
- The demo field is a real padi field in Kedah, Malaysia — specific, named, with a real farming story
- Rice feeds the country. Heat stress and shifting monsoons are already measurable here.
- The Local Impact angle: a Malaysian field puts us in contention for the KL local award
- The pitch names a farmer, names the place, shows the arc — specificity makes impact tangible

### 2. Creativity
Is the approach original?

**How we win this:**
- The "find the twin" framing is the creative leap. Everyone else predicts the future; we find the present-day analogue.
- The backtest twist — showing the 1995 twin vs today proves the method describes something real, not a forecast
- Naming the concept "Climate Twin" is a memorable, human-scale idea that a non-scientist can immediately grasp

### 3. Validity
Is it scientifically defensible?

**How we win this — this is our strongest card:**
- Every number traces back to arithmetic on NASA data. We can show a judge in 10 seconds.
- The honesty panel shows all 8 signature values side by side — no hiding
- The caveats are on screen, always visible, written in plain language
- OLS linear regression is the simplest possible model — we can explain it in one sentence
- Role 3 sanity-checks all outputs against known agricultural geography before demo day
- We say out loud what we do not know: "This is a 50 km gridded value, not a measurement of this field"

**The trap other teams fall into:** overclaiming. Teams that say "our model predicts yield" get taken apart in Q&A. We say "here is a linear trend, here is what it assumes, here is the scatter plot."

### 4. Relevance
Does it use NASA data meaningfully?

**How we win this:**
- NASA POWER is the core of the entire engine — not an add-on, not a logo on a slide
- We use 40 years of daily data, four parameters, computed into 8 derived variables
- The global grid is built from POWER data
- The trend fit is built from POWER data
- Without NASA POWER, the project does not exist

### 5. Presentation
Is it communicated clearly and compellingly?

**How we win this:**
- Role 4 owns this criterion entirely
- Three timed rehearsals before submission
- Demo script: 60s problem → 90s reveal → 30s limitations
- The reveal (the arc) is the visual centrepiece — a stranger understands the idea without explanation
- Large type, high contrast, projector-tested
- Limitations stated before judges ask — this reads as competence

---

## Q&A Preparation

Questions judges will likely ask, and our answers:

**"Why linear regression? Isn't that too simple?"**
> It's intentionally the simplest model that makes a defensible number. We show the scatter plot and the fitted line so you can see exactly how much we're assuming. We're not claiming it's a climate model — we're claiming it's a reasonable direction-of-change estimate on the available data.

**"What if the POWER data is wrong for a specific field?"**
> We say so on screen. POWER is ~50 km gridded data, not a point measurement. For a first-pass 'is my farm warming?' question, it's the best freely available global dataset. A farmer who takes this seriously should validate with local weather station data.

**"Why not use a proper climate model?"**
> For a 48-hour hackathon, any model we can't explain in 10 seconds is a liability in Q&A. OLS on 40 years of observed data is explainable. It also uses only observed data, not model projections, which is a different kind of honest.

**"The twin is in another country — how does that help a Malaysian farmer?"**
> That's exactly the point. It tells the farmer: the conditions you'll face in 2045 are conditions that farmers in [place] deal with today. Here's what they grow. Here's how they adapted. You don't have to guess — someone has already solved the problem you're about to have.

**"Did you build this during the hackathon?"**
> Yes. Preparation (reading documentation, planning the approach, assigning roles) happened before the clock started. All code was written during the event. We used Kiro, Amazon's AI coding tool, as disclosed.
