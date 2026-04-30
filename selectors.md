# Atlas Selector Discovery

Status: NOT YET DISCOVERED. Run Step 0 discovery spike before tuning content.js.

## Page type 1: Course Detail
URL pattern: ___
Working selector: ___
Name format observed: ___

## Page type 2: Search Results
URL pattern: ___
Working selector: ___
Name format observed: ___

## Page type 3: Instructor Profile
URL pattern: ___
Working selector: ___
Name format observed: ___

## Page type 4: Dashboard
URL pattern: ___
Working selector: ___
Name format observed: ___

## Atlas Course Row Selectors (for Workstream B Path b — course harvesting)

A "course row" is the smallest DOM element that contains one course/section listing. Likely found on search results pages and course detail pages.

- Container selector (courseRow): ___
- courseCode (within row): ___
- courseTitle (within row): ___
- term (within row): ___
- sectionId (within row): ___
- instructor (within row): ___ (may be same as instructor-name selector)
- meetingTime (within row): ___
- location (within row): ___
- credits (within row): ___

Discovery procedure:
1. On the search results page, right-click a course → Inspect
2. Walk up the DOM tree until you find the smallest element that contains ALL of: course code, instructor, time
3. That's the courseRow. Note its selector (class or data attribute).
4. For each sub-field, find the working selector relative to the courseRow.
