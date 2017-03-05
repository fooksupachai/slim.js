console.log('SlimJS v2.3.8')

class Slim extends HTMLElement {

    static polyfill(url) {
        if (Slim.__isWCSupported) return;
        document.write('<script src="' + url + '"></script>');
    }

    static tag(tag, clazz) {
        Slim.__prototypeDict[tag] = clazz
        document.registerElement(tag, clazz)
    }

    static getTag(clazz) {
        for (let tag in Slim.__prototypeDict) {
            if (Slim.__prototypeDict[tag] === clazz)
                return tag
        }
    }

    static get interactionEventNames() {
        return ['click','mouseover','mouseout','mousemove','mouseenter','mousedown','mouseup','dblclick','contextmenu','wheel',
            'mouseleave','select','pointerlockchange','pointerlockerror','focus','blur',
            'input', 'error', 'invalid',
            'animationstart','animationend','animationiteration','reset','submit','resize','scroll',
            'keydown','keypress','keyup', 'change']
    }

    static plugin(phase, plugin) {
        if (['create','beforeRender','beforeRemove','afterRender'].indexOf(phase) === -1) {
            throw "Supported phase can be create, beforeRemove, beforeRender or afterRender only"
        }
        Slim.__plugins[phase].push(plugin)
    }

    static registerCustomAttribute(fn) {
        Slim.__customAttributeProcessors.push(fn);
    }

    static __runPlugins(phase, element) {
        Slim.__plugins[phase].forEach( fn => {
            fn(element)
        })
    }

    static __moveChildren(source, target, activate) {
        while (source.children.length) {
            target.appendChild(source.children[0])
        }
        let children = Array.prototype.slice.call( target.querySelectorAll('*'))
        for (let child of children) {
            if (activate && child.isSlim) {
                child.createdCallback(true)
            }
        }
    }

    static __lookup(obj, desc) {
        var arr = desc.split(".");
        var prop = arr[0]
        while(arr.length && obj) {
            obj = obj[prop = arr.shift()]
        }
        return {source: desc, prop:prop, obj:obj};
    }

    static __createRepeater(descriptor) {
        if (Slim.__prototypeDict['slim-repeat'] === undefined) {
            Slim.__initRepeater();
        }
        var repeater
        if (Slim.__isWCSupported) {
            repeater = document.createElement('slim-repeat')
            repeater.sourceNode = descriptor.target
            descriptor.target.parentNode.insertBefore(repeater, descriptor.target)
            descriptor.repeater = repeater
        } else {
            descriptor.target.insertAdjacentHTML('beforebegin', '<slim-repeat slim-new="true"></slim-repeat>')
            repeater = descriptor.target.parentNode.querySelector('slim-repeat[slim-new="true"]')
            repeater.__proto__ = window.SlimRepeater.prototype
            repeater.sourceNode = descriptor.target
            repeater.removeAttribute('slim-new')

            repeater.createdCallback()
        }
        repeater._boundParent = descriptor.source
        descriptor.target.parentNode.removeChild(descriptor.target)
        repeater._isAdjacentRepeater = descriptor.repeatAdjacent
        repeater.setAttribute('source', descriptor.properties[0])
        repeater.setAttribute('target-attr', descriptor.targetAttribute)
        descriptor.repeater = repeater
    }

    static __dashToCamel(dash) {
        return dash.indexOf('-') < 0 ? dash : dash.replace(/-[a-z]/g, m => {return m[1].toUpperCase()})
    }

    static __camelToDash(camel) {
        return camel.replace(/([A-Z])/g, '-$1').toLowerCase();
    }

    find(selector) {
        return this.querySelector(selector);
    }

    findAll(selector) {
        return Array.prototype.slice.call( this.querySelectorAll(selector) );
    }

    watch(prop, executor) {
        let descriptor = {
            type: 'W',
            properties: [ prop ],
            executor: executor,
            target: this,
            source: this
        }
        this._bindings = this._bindings || {}
        this._boundParent = this._boundParent || this
        this.__bind(descriptor)
    }

    callAttribute(attributeName, value) {
        if (!this._boundParent) {
            throw 'Unable to call attribute-bound method when no bound parent available';
        }
        let fnName = this.getAttribute(attributeName)
        if (fnName === null) {
            console.warn && console.warn('Unable to call null attribute-bound method on bound parent ' + this._boundParent.outerHTML)
            return;
        }
        if (typeof this[fnName] === 'function') {
            this[fnName](value)
        } else if (typeof this._boundParent[fnName] === 'function') {
            this._boundParent[fnName](value)
        } else if (this._boundParent && this._boundParent._boundParent && typeof this._boundParent._boundParent[fnName] === 'function') {
            // safari, firefox
            this._boundParent._boundParent[fnName](value)
        } else if (this._boundRepeaterParent && typeof this._boundRepeaterParent[fnName] === 'function') {
            this._boundRepeaterParent[fnName](value)
        } else {
            throw "Unable to call attribute-bound method: " + fnName + ' on bound parent ' + this._boundParent.outerHTML + ' with value ' + value
        }
        if (typeof this.update === 'function' && (this.isInteractive || Slim.autoAttachInteractionEvents || this.getAttribute('interactive'))) {
            this.update()
        }
    }

    __bind(descriptor) {
        descriptor.properties.forEach(
            prop => {
                let rootProp
                if (prop.indexOf('.') > 0) {
                    rootProp = prop.split('.')[0]
                } else {
                    rootProp = prop
                }
                let source = descriptor.target._boundParent || descriptor.parentNode
                source._bindings = source._bindings || {}
                source._bindings[rootProp] = source._bindings[rootProp] || {
                        value: source[rootProp],
                        executors: []
                    }
                if (!source.__lookupGetter__(prop)) source.__defineGetter__(prop, function() {
                    return this._bindings[prop].value
                })
                if (!source.__lookupSetter__(prop)) source.__defineSetter__(prop, function(x) {
                    this._bindings[prop].value = x
                    if (descriptor.sourceText) {
                        descriptor.target.innerText = descriptor.sourceText
                    }
                    this._executeBindings(prop)
                })
                let executor
                if (descriptor.type === 'C') {
                    executor = () => {
                        descriptor.executor()
                    }
                } else if (descriptor.type === 'P') {
                    executor = () => {
                        if (!descriptor.target.hasAttribute('slim-repeat')) {
                            let value = Slim.__lookup(source, prop).obj || Slim.__lookup(descriptor.target, prop).obj
                            descriptor.target[ Slim.__dashToCamel(descriptor.attribute) ] = value
                            descriptor.target.setAttribute( descriptor.attribute, value )
                        }
                    }
                } else if (descriptor.type === 'M') {
                    executor = () => {
                        if (!descriptor.target.hasAttribute('slim-repeat')) {
                            let value = source[ descriptor.method ].apply( source,
                                descriptor.properties.map( prop => { return source[prop] }))
                            descriptor.target[ Slim.__dashToCamel(descriptor.attribute) ] = value
                            descriptor.target.setAttribute( descriptor.attribute, value )
                        }
                    }
                } else if (descriptor.type === 'T') {
                    executor = () => {
                        let source = descriptor.target._boundParent
                        descriptor.target.innerText = descriptor.target.innerText.replace(`[[${prop}]]`, Slim.__lookup(source, prop).obj)
                    }
                } else if (descriptor.type === 'R') {
                    executor = () => {
                        descriptor.repeater.renderList()
                    }
                } else if (descriptor.type === 'W') {
                    executor = () => {
                        descriptor.executor(Slim.__lookup(source, prop).obj)
                    }
                }
                executor.descriptor = descriptor;
                source._bindings[rootProp].executors.push( executor )
            }
        )
    }

    static __processRepeater(attribute, child) {
        return {
            type: 'R',
            target: child,
            targetAttribute: child.getAttribute('slim-repeat-as') ? child.getAttribute('slim-repeat-as') : 'data',
            repeatAdjacent: child.hasAttribute('slim-repeat-adjacent'),
            attribute: attribute.nodeName,
            properties: [ attribute.nodeValue ],
            source: child._boundParent
        }
    }

    static __processAttributeCustom(attribute, child, customAttributeProcessor) {
        return customAttributeProcessor(attribute, child)
    }

    static __processAttribute(attribute, child) {
        if (attribute.nodeName === 'slim-repeat') {
            return Slim.__processRepeater(attribute, child)
        }

        const rxInject = /\{(.+[^(\((.+)\))])\}/.exec(attribute.nodeValue)
        const rxProp = /\[\[(.+[^(\((.+)\))])\]\]/.exec(attribute.nodeValue)
        const rxMethod = /\[\[(.+)(\((.+)\)){1}\]\]/.exec(attribute.nodeValue)

        if (rxMethod) {
            return {
                type: 'M',
                target: child,
                attribute: attribute.nodeName,
                method: rxMethod[1],
                properties: rxMethod[3].replace(' ','').split(',')
            }
        } else if (rxProp) {
            return {
                type: 'P',
                target: child,
                attribute: attribute.nodeName,
                properties: [ rxProp[1] ]
            }
        } else if (rxInject) {
            return {
                type: 'I',
                target: child,
                attribute: attribute.nodeName,
                factory: rxInject[1]
            }
        }
    }

    get isVirtual() {
        let node = this
        while (node) {
            node = node.parentNode
            if (!node) {
                return true
            }
            if (node.nodeName === 'BODY') {
                return false
            }
        }
        return true
    }

    get rootElement() {
        if (this.useShadow) {
            this.__shadowRoot = this.__shadowRoot || this.createShadowRoot()
            return this.__shadowRoot
        }
        return this
    }

    createdCallback(force = false) {
        this.onBeforeCreated();
        this.initialize()
        if (this.isVirtual && !force) return
        this._captureBindings()
        Slim.__runPlugins('create', this)
        this.onCreated()
        this.__onCreatedComplete = true
        this.onBeforeRender()
        Slim.__runPlugins('beforeRender', this)
        Slim.__moveChildren( this._virtualDOM, this.rootElement, true )
        this.onAfterRender()
        Slim.__runPlugins('afterRender', this)
        this.update()
    }

    detachedCallback() {
        Slim.__runPlugins('beforeRemove', this)
        this.onRemoved()
    }

    _initInteractiveEvents() {
        if (!this.__eventsInitialized && (Slim.autoAttachInteractionEvents || this.isInteractive || this.hasAttribute('interactive'))) Slim.interactionEventNames.forEach(eventType => {
            this.addEventListener(eventType, e => { this.handleEvent(e) })
        })
    }

    initialize(forceNewVirtualDOM = false) {
        this._bindings = this._bindings || {}
        this._initInteractiveEvents();
        this.__eventsInitialized = true;
        this._boundChildren = this._boundChildren || []
        this.alternateTemplate = this.alternateTemplate || null
        if (forceNewVirtualDOM) {
            this._virtualDOM = document.createElement('slim-root')
        }
        this._virtualDOM = this._virtualDOM || document.createElement('slim-root')
    }

    get isSlim() { return true }
    get template() { return null }
    get isInteractive() { return false }

    handleEvent(e) {
        if (this.hasAttribute('on' + e.type)) {
            this.callAttribute('on' + e.type, e)
        } else if (this.hasAttribute(e.type)) {
            this.callAttribute(e.type, e)
        }
    }

    attachedCallback() {
        this.onAdded();
    }

    onAdded() { /* abstract */ }
    onRemoved() { /* abstract */ }
    onBeforeCreated() { /* abstract */ }
    onCreated() { /* abstract */}
    onBeforeRender() { /* abstract */ }
    onAfterRender() { /* abstract */ }
    onBeforeUpdate() { /* abstract */ }
    onAfterUpdate() { /* abstract */ }

    update() {
        this.onBeforeUpdate()
        this._executeBindings()
        this.onAfterUpdate()
    }

    render(template) {
        Slim.__runPlugins('beforeRender', this)
        this.onBeforeRender()
        this.alternateTemplate = template
        this.initialize(true)
        this.innerHTML = ''
        this._captureBindings()
        this._executeBindings()
        Slim.__moveChildren( this._virtualDOM, this.rootElement, true )
        this.onAfterRender()
        Slim.__runPlugins('afterRender', this)
    }


    _executeBindings(prop) {
        // reset bound texts
        this._boundChildren.forEach( child => {
            // this._boundChildren.forEach( child => {
            if (child.hasAttribute('bind') && child.sourceText !== undefined) {
                child.innerText = child.sourceText
            }
        })

        // execute specific binding or all
        const properties = prop ? [ prop ] : Object.keys(this._bindings)
        properties.forEach( property => {
            this._bindings[property].executors.forEach( fn => {
                if (fn.descriptor.type !== 'T') fn()
            } )
        })

        // execute text bindings always
        Object.keys(this._bindings).forEach( property => {
            this._bindings[property].executors.forEach( fn => {
                if (fn.descriptor.type === 'T') {
                    fn();
                }
            })
        })
    }

    _captureBindings() {
        let $tpl = this.alternateTemplate || this.template
        if (!$tpl) {
            while (this.children.length) {
                this._virtualDOM.appendChild( this.children[0] )
            }
        } else if (typeof($tpl) === 'string') {
            this._virtualDOM.innerHTML = $tpl
            let virtualContent = this._virtualDOM.querySelector('content')
            if (virtualContent) {
                while (this.children.length) {
                    this.children[0]._boundParent = this.children[0]._boundParent || this
                    virtualContent.appendChild( this.children[0] )
                }
            }
        }

        let allChildren = Array.prototype.slice.call( this._virtualDOM.querySelectorAll('*') )
        for (let child of allChildren) {
            child._sourceOuterHTML = child.outerHTML
            child._boundParent = child._boundParent || this
            this._boundChildren.push(child)
            if (child.getAttribute('slim-id')) {
                child._boundParent[ Slim.__dashToCamel(child.getAttribute('slim-id')) ] = child
            }
            let slimID = child.getAttribute('slim-id')
            if (slimID) this[slimID] = child
            let descriptors = []
            if (child.attributes) for (let i = 0; i < child.attributes.length; i++) {
                if (!child.isSlim && Slim.interactionEventNames.indexOf(child.attributes[i].nodeName) >= 0) {
                    child.isInteractive = true;
                    child.addEventListener(child.attributes[i].nodeName, e => { child.handleEvent(e) })
                    child.handleEvent = this.handleEvent.bind(child);
                    child.callAttribute = this.callAttribute.bind(child);
                }
                let desc = Slim.__processAttribute(child.attributes[i], child)
                if (desc) descriptors.push(desc)
                Slim.__customAttributeProcessors.forEach( attrProcessor => {
                    desc = Slim.__processAttributeCustom( child.attributes[i], child, attrProcessor );
                    if (desc) descriptors.push(desc);
                })
                child[Slim.__dashToCamel(child.attributes[i].nodeName)] = child.attributes[i].nodeValue
                if (child.attributes[i].nodeName.indexOf('#') == '0') {
                    let refName = child.attributes[i].nodeName.slice(1)
                    this[refName] = child
                }
            }

            descriptors = descriptors.sort( (a) => {
                if (a.type === 'I') { return -1 }
                else if (a.type === 'R') return 1
                return 0
            })

            descriptors.forEach(
                descriptor => {
                    if (descriptor.type === 'P' || descriptor.type === 'M' || descriptor.type === 'C') {
                        this.__bind(descriptor)
                    } else if (descriptor.type === 'I') {
                        Slim.__inject(descriptor)
                    } else if (descriptor.type === 'R') {
                        Slim.__createRepeater(descriptor)
                        this.__bind(descriptor)
                    }
                }
            )
        }

        allChildren = Array.prototype.slice.call( this._virtualDOM.querySelectorAll('*[bind]'))

        for (let child of allChildren) {
            let match = child.innerText.match(/\[\[([\w|.]+)\]\]/g)
            if (match && child.children.length > 0) {
                throw 'Bind Error: Illegal bind attribute use on element type ' + child.localName + ' with nested children.\n' + child.outerHTML;
            }
            if (match) {
                let properties = []
                for (let i = 0; i < match.length; i++) {
                    let lookup = match[i].match(/([^\[].+[^\]])/)[0]
                    properties.push(lookup)
                }
                let descriptor = {
                    type: 'T',
                    properties: properties,
                    target: child,
                    sourceText: child.innerText
                }
                child.sourceText = child.innerText
                this.__bind(descriptor)
            }
        }
    }

}

Slim.__customAttributeProcessors = []
Slim.__prototypeDict = {}
Slim.__plugins = {
    'create': [],
    'beforeRender': [],
    'afterRender': [],
    'beforeRemove': []
}

try {
    Slim.__isWCSupported = (function() {
        return ('registerElement' in document
        && 'import' in document.createElement('link')
        && 'content' in document.createElement('template'))
    })()
}
catch (err) {
    Slim.__isWCSupported = false
}

Slim.__initRepeater = function() {
    class SlimRepeater extends Slim {
        get sourceData() {
            try {
                let lookup = Slim.__lookup(this._boundParent, this.getAttribute('source'))
                return lookup.obj || []
            }
            catch (err) {
                return []
            }
        }

        get isVirtual() {
            return false
        }

        onRemoved() {
            this.sourceData.unregisterSlimRepeater(this)
        }

        registerForRender() {
            if (this.pendingRender) return;
            this.pendingRender = true;
                setTimeout( () => {
                this.checkoutRender();
            }, 0);
        }

        checkoutRender() {
            this.pendingRender = false;
            this.renderList();
        }

        renderList() {
            let targetPropName = this.getAttribute('target-attr')
            if (!this.sourceNode) return
            this.clones = []
            this.innerHTML = ''

            this.sourceData.registerSlimRepeater(this)
            this.sourceData.forEach( (dataItem, index) => {
                let clone = this.sourceNode.cloneNode(true)
                clone.removeAttribute('slim-repeat')
                clone.removeAttribute('slim-repeat-as')
                clone.setAttribute('slim-repeat-index', index)
                if (!Slim.__isWCSupported) {
                    this.insertAdjacentHTML('beforeEnd', clone.outerHTML)
                    clone = this.find('*[slim-repeat-index="' + index.toString() + '"]')
                }
                clone[targetPropName] = dataItem
                clone.data_index = index
                clone.data_source = this.sourceData
                clone.sourceText = clone.innerText
                if (Slim.__isWCSupported) {
                    this.insertAdjacentElement('beforeEnd', clone)
                }
                this.clones.push(clone)
            })
            this._captureBindings()
            for (let clone of this.clones) {
                clone[targetPropName] = clone[targetPropName]
                clone._boundRepeaterParent = this._boundParent
                if (Slim.__prototypeDict[clone.localName] !== undefined || clone.isSlim) {
                    clone._boundParent = this._boundParent
                }
                else {
                    clone._boundParent = clone
                }
                Array.prototype.slice.call(clone.querySelectorAll('*')).forEach( element => {
                    element._boundParent = clone._boundParent
                    element._boundRepeaterParent = this._boundParent
                    element[targetPropName] = clone[targetPropName]
                    element.data_index = clone.data_index
                    element.data_source = clone.data_source
                })
            }

            this._executeBindings()
            if (this._isAdjacentRepeater) {
                Slim.__moveChildren(this._virtualDOM, this.parentNode, true)
            } else {
                Slim.__moveChildren(this._virtualDOM, this, true)
            }
        }
    }
    Slim.tag('slim-repeat', SlimRepeater)

    window.SlimRepeater = SlimRepeater
}
window.Slim = Slim
;(function() {

    const originals = {};
    ['push','pop','shift', 'unshift', 'splice', 'sort', 'reverse'].forEach( function(method) {
        originals[method] = Array.prototype[method]
        Array.prototype[method] = function() {
            let result = originals[method].apply(this, arguments)
            if (this.registeredSlimRepeaters) {
                this.registeredSlimRepeaters.forEach( repeater => {
                    repeater.registerForRender();
                })
            }
            return result
        }
    })


    Array.prototype.registerSlimRepeater = function(repeater) {
        this.registeredSlimRepeaters = this.registeredSlimRepeaters || []

        if (this.registeredSlimRepeaters.indexOf(repeater) < 0) {
            this.registeredSlimRepeaters.push(repeater)
        }
    }

    Array.prototype.unregisterSlimRepeater = function(repeater) {
        if (this.registeredSlimRepeaters && this.registeredSlimRepeaters.indexOf(repeater) >= 0) {
            this.registeredSlimRepeaters.splice( this.registeredSlimRepeaters.indexOf(repeater), 1)
        }
    }

})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports.Slim = Slim
}

