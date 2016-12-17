import actionToPath from './pure-utils/actionToPath'
import pathToAction from './pure-utils/pathToAction'
import nestAction from './pure-utils/nestAction'
import isLocationAction from './pure-utils/isLocationAction'
import routesDictToArray from './pure-utils/routesDictToArray'

import { NOT_FOUND } from './actions'


/** PRIMARY EXPORT: `connectTypes(routes: object, history: history, options: object)`
 *  `connectTypes` returns: `{reducer, middleware, enhancer}` 
 * 
 *  Internally it is powered by listening of location-aware dispatches 
 *  through the middleware as well as through listening to `window.location` history changes
 * 
 *  note: if you're wondering, the following function when called returns functions
 *  in a closure that provide access to variables in a private
 *  "per instance" fashion in order to be used in SSR without leaking
 *  state between SSR requests :).
*/

export default function connectTypes(routes={}, history, options) {
  if(process.env.NODE_ENV !== 'production') {
    if(!history) {
      throw new Error('invalid-history-argument', `Using the 'history' package on NPM, please provide 
        a history object as a second parameter. The history object will be the return of 
        createBrowserHistory() (or in React Native or Node: createMemoryHistory()).
        See: https://github.com/mjackson/history`)
    }
  }
  

  /** INTERNAL CLOSURE STATE (PER INSTANCE FOR SSR!) */

  let currentPathname = history.location.pathname             // very important: used for determining address bar changes

  const HISTORY = history                                     // history object created via createBrowserHistory or createMemoryHistory (using history package) passed to connectTypes(routesDict, history)
  const ROUTES_DICT = routes                                  // {HOME: '/home', INFO: '/info/:param'} -- our route "constants" defined by our user (typically in configureStore.js)
  const ROUTE_NAMES = Object.keys(ROUTES_DICT)                // ['HOME', 'INFO', 'ETC']
  const ROUTES = routesDictToArray(ROUTE_NAMES, ROUTES_DICT)  // ['/home', '/info/:param/', '/etc/:etc']
  
  const {type, payload} = pathToAction(currentPathname, ROUTES, ROUTE_NAMES)

  const INITIAL_LOCATION_STATE = {
    pathname: currentPathname,
    type,
    payload,
    prev: {                     
      pathname: null,
      type: null,
      payload: null,
    },
    history: typeof window !== 'undefined' ? history : undefined,
  }

  const {
    onBackNext, 
    location: locationKey='location',
    title: titleKey,
  } = options


  /** LOCATION REDUCER: */

  function locationReducer(state=INITIAL_LOCATION_STATE, action) {
    if(ROUTES_DICT[action.type] || action.type === NOT_FOUND) {
      state = {
        pathname: action.meta.location.current.pathname,
        type: action.type,
        payload: action.payload || {},
        prev: action.meta.location.prev || state.prev,
        history: state.history,
      }

      if(action.meta.location.load) {
        state.load = true
      }

      if(action.meta.location.backNext) {
        state.backNext = true
      }
    }

    return state
  }


  /** MIDDLEWARE */

  function middleware(store) {
    return next => action => {
      if(action.error && isLocationAction(action)) {
        if(process.env.NODE_ENV !== 'production') {
          console.warn(`pure-redux-router: location update did not dispatch as your action has an error.`)
        }
      }
      
      // user decided to dispatch `NOT_FOUND`, so we fill in the missing location info
      else if(action.type === NOT_FOUND && !isLocationAction(action)) {
        let {pathname} = store.getState().location
        action = _prepareAction(pathname, {type: NOT_FOUND, payload: action.payload || {}})
      }

      // browser back/forward button usage will dispatch with locations and dont need to be re-handled
      else if(ROUTES_DICT[action.type] && !isLocationAction(action)) { 
        action = createMiddlewareAction(action, ROUTES_DICT, store.getState().location)
      }

      let nextAction = next(action)
      let nextState = store.getState()

      changeAddressBar(nextState) 

      return nextAction
    }
  }

  /** ENHANCER */

  function enhancer(createStore) {
    return (reducer, preloadedState, enhancer) => {
      let store = createStore(reducer, preloadedState, enhancer)
      
      let state = store.getState()
      let location = state[locationKey]

      if(!location || !location.pathname) {
        throw new Error('no-location-reducer', `
          You must provide the key of the location reducer state 
          and properly assigned the location reducer to that key.
        `)
      }

      let dispatch = store.dispatch.bind(store)
      HISTORY.listen(handleHistoryChanges.bind(null, dispatch))
      
      let firstAction = createHistoryAction(currentPathname, 'load')
      store.dispatch(firstAction)

      return store
    }
  }


  /** ADDRESS BAR + BROWSER BACK/NEXT BUTTON HANDLING */

  function handleHistoryChanges(dispatch, location) {
    // insure middleware hasn't already handled location change
    if(location.pathname !== currentPathname) { 
      onBackNext && onBackNext(location)
      currentPathname = location.pathname

      let action = createHistoryAction(currentPathname)
      dispatch(action) // dispatch route type + payload as it changes via back/next buttons usage
    } 
  }

  function changeAddressBar(nextState) {
    let location = nextState[locationKey]

    if(location.pathname !== currentPathname) {
      currentPathname = location.pathname
      HISTORY.push({pathname: currentPathname})
      changePageTitle(nextState[titleKey])
    }
  }

  function changePageTitle(title) {
    if(typeof window !== 'undefined' && typeof title === 'string') {
      document.title = title
    }
  }

  
  /** ACTION CREATORS: */

  function createMiddlewareAction(action, routesDict, location) {
    try {
      let pathname = actionToPath(action, routesDict)
      return _prepareAction(pathname, action) 
    }
    catch(e) {
      //developer dispatched an invalid type + payload
      //preserve previous pathname to keep app stable for future correct actions that depend on it
      let pathname = location && location.pathname || null 
      let payload = action.payload || {};
      return _prepareAction(pathname, {type: NOT_FOUND, payload})
    }
  }

  function createHistoryAction(pathname, kind='backNext', routes=ROUTES, routeNames=ROUTE_NAMES) {
    let action = pathToAction(pathname, routes, routeNames)
    action = _prepareAction(pathname, action)
    action.meta.location[kind] = true
    return action
  }


  /* INTERNAL UTILITY FUNCTIONS (THE USE OUR ENCLOSED STATE) **/

  let prev = null

  function _prepareAction(pathname, receivedAction) {
    let action = nestAction(pathname, receivedAction, prev)
    prev = {...action.meta.location.current}
    return action
  }

  _exportedGo = function(pathname, routes=ROUTES, routeNames=ROUTE_NAMES) { 
    return pathToAction(pathname, routes, routeNames) // only pathname arg expected in client code
  }


  //** OUR GLORIOUS RETURN: reducer, middleware and enhancer */

  return {
    reducer: locationReducer,
    middleware,
    enhancer,
  }
}

/** SIDE EFFECT:
 *  Client code needs a simple go to path function. `exportedGo` gets replaced with a function aware of private instance variables.
 *  NOTE: it's also used by https://github.com/celebvidy/pure-redux-router-link 's `<Link /> component.
 *  NOTE: it will not harm SSR (unless you simulate clicking links server side--and dont do that, dispatch actions instead).
*/

let _exportedGo;

export function go(pathname) {
  if(typeof _exportedGo === 'undefined') {
    if(process.env.NODE_ENV !== 'production') {
      console.warn(`
        you are calling 'go' before pure-redux-router has connected your types to paths. 
        Find a way to not do that so you don't miss your initial dispatches :)
      `)
    }
  }

  return exportedGo(pathname);
}