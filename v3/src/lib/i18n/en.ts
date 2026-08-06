/**
 * English. The complete dictionary, and the fallback for every other language.
 *
 * Its shape defines the `Dictionary` type, so a key added here and forgotten
 * elsewhere is a compile-time gap rather than a blank space on a weaver's
 * phone.
 */
export const en = {
  common: {
    signIn: 'Sign in',
    signOut: 'Sign out',
    back: 'Back',
    notBuiltYet: 'Not built yet',
  },

  login: {
    brand: 'Nerige',
    userId: 'User ID',
    userIdHint: 'The ID Nerige gave you.',
    userIdPlaceholder: 'hdr',
    password: 'Password',
    signingIn: 'Signing in…',
    // One message for both halves, on purpose: naming which one was wrong turns
    // the form into a list of who has an account here.
    wrongCredentials: 'That user ID or password is not right.',
    byInvitation: 'Access is by invitation. Ask the Nerige team if you cannot sign in.',
  },

  nav: {
    myOrders: 'My orders',
    myDesigns: 'My designs',
    reorder: 'Reorder',
    orders: 'Orders',
  },

  order: {
    orderFrom: 'Order from Nerige',
    issued: 'Sent',
    sectionRestock: 'Make these again',
    sectionRestockHelp: 'Write the code shown on each piece before you pack it.',
    sectionNewDesigns: 'New designs',
    sectionNewDesignsHelp: 'Nothing here has a code yet.',
    noCode: 'No code, we will label this on arrival',
    pieces_one: '{n} piece',
    pieces_other: '{n} pieces',
    likeThese: 'Make me more like these',
    referencePhotos: 'For reference only — do not copy the code',
    soldOut: 'Sold out',
    lastPiece: 'Last piece',

    accept: 'Accept order',
    accepting: 'Accepting…',
    promisedDate: 'When will these be ready?',
    promisedDateHint: 'Give the date you can have them ready by.',
    acceptedOn: 'You accepted this order',
    promised: 'Promised by',

    dispatch: 'Mark as dispatched',
    dispatching: 'Saving…',
    dispatchDate: 'Date sent',
    docket: 'Transport docket number',
    docketHint: 'Optional. The number the transporter gives you.',
    dispatchedOn: 'Sent on',
    docketIs: 'Docket',

    cancelled: 'This order was cancelled.',
    received: 'Nerige has received this order.',
    dateInPast: 'Choose a date from today onwards.',
    couldNotSave: 'Could not save that. Please try again.',
    notFound: 'That order is not here',
    notFoundHelp: 'It may have been cancelled, or the link may belong to someone else.',
    emptyOrder: 'This order has no lines.',
  },

  portal: {
    toAccept: 'To accept',
    toAcceptHelp: 'Tell Nerige when you can have these ready.',
    inProgress: 'In progress',
    inProgressHelp: 'Accepted. Mark them sent when they go.',
    sent: 'Sent',
    nothingYet: 'Nothing has been sent to you yet.',
    linesInOrder: '{n} lines',
    promisedBy: 'Promised by',
    sentOn: 'Sent',
  },

  catalogue: {
    title: 'My designs',
    everyDesign: 'Every design Nerige holds for you.',
    collections: 'Collections',
    designsCount: '{n} designs',
    search: 'Search by code or name',
    searchAction: 'Search',
    clear: 'Clear',
    resultsFor: 'Results for',
    noResults: 'Nothing matches that. Try part of a code, like VINT or 15549.',
    allCollections: 'All collections',
    allColours: 'All colours',
    allFabrics: 'All fabrics',
    backToCollections: 'All collections',
    print: 'Print',
    page: 'Page {n} of {total}',
    next: 'Next',
    previous: 'Previous',

    // Every quantity on screen carries its age. A stale number shown as live is
    // worse than no number.
    inStock_one: '{n} in stock',
    inStock_other: '{n} in stock',
    soldOut: 'Sold out',
    checkedAgo: 'checked {ago}',
    neverChecked: 'stock never checked',
  },

  auth: {
    cannotSignIn: 'Could not sign you in',
    somethingWrong: 'Something went wrong. Please try signing in again.',
    notProvisioned:
      'That account is not set up for this portal. Access is by invitation — ask the Nerige team to add you.',
    backToSignIn: 'Back to sign in',
    noAccess: 'You do not have access to that page',
    noAccessHelp: 'If you think this is wrong, ask the Nerige team to check your account.',
  },
} as const

export type Dictionary = typeof en
