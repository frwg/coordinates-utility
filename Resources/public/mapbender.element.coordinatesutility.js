/*jslint browser: true, nomen: true*/
/*globals initDropdown, Mapbender, OpenLayers, Proj4js, _, jQuery*/

(function ($) {
    'use strict';

    $.widget("mapbender.mbCoordinatesUtility", {
        options: {
            target:    null
        },
        mapClickActive: false,

        isPopupDialog: false,

        callback:       null,

        /**
         * @var {mapbender.mbMap}
         */
        mbMap:          null,
        highlightLayer: null,

        /**
         * @var null | {string}
         */
        currentMapCoordinate: null,

        /**
         * @var null | {string}
         */
        transformedCoordinate: null,
        lon: null,
        lat: null,

        DECIMAL_ANGULAR: 6,
        DECIMAL_METRIC: 2,
        STRING_SEPARATOR: ' ',

        /**
         * Widget constructor
         *
         * @private
         */
        _create: function () {
            var widget = this,
                options = widget.options;

            if (!Mapbender.checkTarget("mbCoordinatesUtility", options.target)) {
                return;
            }

            Mapbender.elementRegistry.onElementReady(options.target, $.proxy(widget._setup, widget));
        },

        /**
         * Setup widget
         *
         * @private
         */
        _setup: function () {
            this.mbMap = $("#" + this.options.target).data("mapbenderMbMap");
            this.highlightLayer = new OpenLayers.Layer.Vector();

            this.isPopUpDialog = !this.element.closest('.sidePane,.sideContent').length;

            this._initializeMissingSrsDefinitions(this.options.srsList);
            this._setupButtons();
            this._setupSrsDropdown();
            this._setupEventListeners();

            this._trigger('ready');
        },

        /**
         * Initialize srs definitions which are not set before and missing in Proj4js.defs array
         *
         * @param srsList
         * @private
         */
        _initializeMissingSrsDefinitions: function (srsList) {

            if (null === srsList || typeof srsList.length === "undefined") {
                return;
            }

            srsList.map(function (srs) {
                if (typeof Proj4js.defs[srs.name] === "undefined") {
                    Proj4js.defs[srs.name] = srs.definition;
                }
            });
        },

        /**
         * Setup widget buttons
         *
         * @private
         */
        _setupButtons: function () {
            var widget = this;

            $('.copyClipBoard', widget.element).on('click',  $.proxy(widget._copyToClipboard, widget));
            $('.center-map', widget.element).on('click',  $.proxy(widget._centerMap, widget));

            if (!widget.isPopUpDialog) {
                var coordinateSearchButton = $('.coordinate-search', this.element);

                coordinateSearchButton.on('click', function () {
                    var isActive = $(this).hasClass('active');

                    if (isActive) {
                        widget.deactivate();
                    } else {
                        widget.activate();
                    }
                });

                coordinateSearchButton.removeClass('hidden');
            }
        },

        /**
         * Create SRS dropdown
         *
         * @private
         */
        _setupSrsDropdown: function () {
            var widget = this,
                dropdown = $('select.srs', widget.element);

            if (dropdown.children().length === 0) {
                var srsList = this._getDropdownSrsList();
                if (!srsList.length) {
                    Mapbender.error(Mapbender.trans("mb.coordinatesutility.widget.error.noSrs"));
                    return;
                }
                dropdown.append(srsList.map(function(srs) {
                    return $('<option>').val(srs.name).text(srs.title || srs.name);
                }));
            }

            initDropdown.call($('.dropdown', this.element));
            this._setDefaultSelectedValue(dropdown);
        },

        /**
         * Get SRS descriptor objects for the dropdown
         *
         * @private
         */
        _getDropdownSrsList: function () {
            var srsList = (this.options.srsList || []).slice();
            if (this.options.addMapSrsList) {
                var mapSrs = this.mbMap.getAllSrs();
                var srsNames = srsList.map(function (srs) {
                    return srs.name;
                });
                mapSrs.forEach(function(srs) {
                    if (srsNames.indexOf(srs.name) === -1) {
                        srsList.push(srs);
                    }
                });
            }
            return srsList;
        },

        /**
         * Check if SRS is valid
         *
         * @param srs
         * @returns {boolean}
         * @private
         */
        _isValidSRS: function (srs) {
            var projection = new OpenLayers.Projection(srs),
                isValid = true;

            if (typeof projection.proj.defData === 'undefined') {
                isValid = false;
            }

            return isValid;
        },

        /**
         * Set selected by default value in dropdown
         *
         * @param {jQuery} dropdown
         * @private
         */
        _setDefaultSelectedValue: function (dropdown) {
            var currentSrs = this.mbMap.getModel().getCurrentProjectionCode();
            dropdown.val(currentSrs);
        },

        /**
         * Setup event listeners
         *
         * @private
         */
        _setupEventListeners: function () {
            var widget = this;

            $(document).on('mbmapsrschanged', $.proxy(widget._resetFields, widget));

            $('select.srs', this.element).on('change', function() {
                widget._recalculateDisplayCoordinate($(this).val());
            });
            $('input.input-coordinate', widget.element).on('change', $.proxy(widget._transformCoordinateToMapSrs, widget));
            this.mbMap.element.on('mbmapclick', function(event, data) {
                widget._mapClick(event, data);
            });
        },

        /**
         * Popup HTML window
         */
        popup: function () {
            var widget = this,
                element = widget.element;

            if (!widget.popupWindow || !widget.popupWindow.$element) {
                widget.popupWindow = new Mapbender.Popup2({
                    title:                  element.attr('title'),
                    draggable:              true,
                    resizable:              true,
                    modal:                  false,
                    closeButton:            false,
                    closeOnPopupCloseClick: true,
                    closeOnESC:             false,
                    destroyOnClose:         false,
                    detachOnClose:          false,
                    content:                this.element.removeClass('hidden'),
                    width:                  450,
                    height:                 400,
                    buttons:                {}
                });

                widget.popupWindow.$element.on('close', function () {
                    widget.close();
                });
            }

            widget.popupWindow.$element.removeClass('hidden');
        },

        /**
         * On open handler
         */
        open: function (callback) {
            this.callback = callback;

            this.popup();
            this.activate();
        },

        /**
         * On close
         */
        close: function () {
            if (this.popupWindow && this.popupWindow.$element) {
                this.popupWindow.$element.addClass('hidden');
            }
            if (this.callback) {
                this.callback.call();
                this.callback = null;
            }

            this.deactivate();
            this._resetFields();
        },

        /**
         * Activate coordinate search
         */
        activate: function () {
            this.mbMap.map.element.addClass('crosshair');
            this.mbMap.map.olMap.addLayer(this.highlightLayer);
            $('.coordinate-search', this.element).addClass('active');
            this.mapClickActive = true;
        },

        /**
         * Deactivate coordinate search
         */
        deactivate: function () {
            this.mbMap.map.element.removeClass('crosshair');
            this.mbMap.map.olMap.removeLayer(this.highlightLayer);
            $('.coordinate-search', this.element).removeClass('active');
            this.mapClickActive = false;
        },
        /**
         * New-style sidepane API: containing pane is visible
         */
        reveal: function() {
            this.activate();
            this._showFeature();
        },
        /**
         * New-style sidepane API: containing pane is hidden
         */
        hide: function() {
            this.deactivate();
            this._removeFeature();
        },

        /**
         * On map click handler
         *
         * @param {Event} event
         * @param {*} data
         * @private
         */
        _mapClick: function (event, data) {
            if (!this.mapClickActive) {
                return;
            }
            var x = this.lon = data.coordinate[0];
            var y = this.lat = data.coordinate[1];
            var mapSrs = this.mbMap.getModel().getCurrentProjectionCode();
            this.currentMapCoordinate = this._formatOutputString(x, y, mapSrs);

            var selectedSrs = $('select.srs', this.element).val();
            if (selectedSrs) {
                if (selectedSrs !== mapSrs) {
                    var transformed = this._transformCoordinate(x, y, selectedSrs, mapSrs);
                    this.transformedCoordinate = this._formatOutputString(transformed.x, transformed.y, selectedSrs);
                } else {
                    this.transformedCoordinate = this.currentMapCoordinate;
                }
            }

            this._updateFields();
            this._showFeature();
        },

        /**
         * @param {number} x
         * @param {number} y
         * @param {string} targetSrs
         * @param {string} [sourceSrs] implicitly current map srs
         * @return {{x: number, y: number}}
         * @private
         */
        _transformCoordinate: function(x, y, targetSrs, sourceSrs) {
            var sourceSrs_ = sourceSrs || this.mbMap.getModel().getCurrentProjectionCode();
            var lonlat = new OpenLayers.LonLat(x, y).transform(sourceSrs_, targetSrs);
            return {
                x: lonlat.lon,
                y: lonlat.lat
            };
        },
        /**
         * Format output coordinate string
         *
         * @param {number} x
         * @param {number} y
         * @param {string} srsCode
         * @returns {string}
         * @private
         */
        _formatOutputString: function (x, y, srsCode) {
            var decimals = (this.mbMap.getModel().getProjectionUnitsPerMeter(srsCode) > 0.25)
                ? this.DECIMAL_METRIC
                : this.DECIMAL_ANGULAR;

            return x.toFixed(decimals) + this.STRING_SEPARATOR + y.toFixed(decimals);
        },

        /**
         * Update coordinate input fields
         *
         * @private
         */
        _updateFields: function () {
            $('input.map-coordinate', this.element).val(this.currentMapCoordinate);
            $('input.input-coordinate', this.element).val(this.transformedCoordinate);
        },

        /**
         * Reset coordinate input fields
         *
         * @private
         */
        _resetFields: function () {
            this.currentMapCoordinate = null;
            this.transformedCoordinate = null;
            this.lon = null;
            this.lat = null;
            $('input.map-coordinate', this.element).val('');
            $('input.input-coordinate', this.element).val('');
            this._removeFeature();
        },

        /**
         * Redisplay last selected coordinate after change of (own) input srs selector.
         * @param {string} selectedSrs
         * @private
         */
        _recalculateDisplayCoordinate: function(selectedSrs) {
            if (!selectedSrs) {
                console.error("No srs");
                return;
            }
            if (null !== this.lon && null !== this.lat) {
                var mapSrs = this.mbMap.getModel().getCurrentProjectionCode();
                if (mapSrs !== selectedSrs) {
                    var transformed = this._transformCoordinate(this.lon, this.lat, selectedSrs, mapSrs);
                    this.transformedCoordinate = this._formatOutputString(transformed.x, transformed.y, selectedSrs);
                } else {
                    this.transformedCoordinate = this._formatOutputString(this.lon, this.lat, selectedSrs);
                }
            }

            this._updateFields();
        },

        /**
         * Show feature on the map
         *
         * @private
         */
        _showFeature: function () {
            this.highlightLayer.removeAllFeatures();
            if (null !== this.lon && null !== this.lat) {
                var geometry = new OpenLayers.Geometry.Point(this.lon, this.lat);
                var feature = new OpenLayers.Feature.Vector(geometry);
                this.highlightLayer.addFeatures(feature);
            }
        },

        /**
         * Remove feature from the map
         *
         * @private
         */
        _removeFeature: function () {
            this.highlightLayer.removeAllFeatures();
        },

        /**
         * Copy a coordinate to the buffer
         *
         * @param e
         * @private
         */
        _copyToClipboard: function (e) {
            $(e.target).parent().find('input').select();
            document.execCommand("copy");
        },

        /**
         * Center the map accordingly to a selected coordinate
         *
         * @private
         */
        _centerMap: function () {
            if (null === this.lon || null === this.lat) {
                return;
            }

            if (this._areCoordinatesValid(this.lon, this.lat)) {
                this._showFeature();
                this.mbMap.getModel().centerXy(this.lon, this.lat, {zoom: this.options.zoomlevel});
            } else {
                Mapbender.error(Mapbender.trans("mb.coordinatesutility.widget.error.invalidCoordinates"));
            }
        },

        /**
         * Check if coordinates to navigate are valid
         *
         * @returns boolean
         * @private
         */
        _areCoordinatesValid: function (x, y) {
            if (!$.isNumeric(x) || !$.isNumeric(y)) {
                return false;
            }
            var mapExtentArray = this.mbMap.getModel().getMaxExtentArray();
            return (x >= mapExtentArray[0] && x <= mapExtentArray[2] && y >= mapExtentArray[1] && y <= mapExtentArray[3]);
        },

        /**
         * Transform coordinates from selected SRS to a map SRS
         *
         * @private
         */
        _transformCoordinateToMapSrs: function () {
            var selectedSrs = $('select.srs', this.element).val();
            var inputCoordinates = $('input.input-coordinate', this.element).val();
            var inputCoordinatesArray = inputCoordinates.split(/ \s*/);

            var lat = parseFloat(inputCoordinatesArray.pop());
            var lon = parseFloat(inputCoordinatesArray.pop());

            var mapProjection = this.mbMap.getModel().getCurrentProjectionCode();
            var transformed = this._transformCoordinate(lon, lat, mapProjection, selectedSrs);

            this.lon = transformed.x;
            this.lat = transformed.y;

            if (this._areCoordinatesValid(transformed.x, transformed.y)) {
                if (selectedSrs !== mapProjection) {
                    this.currentMapCoordinate = this._formatOutputString(transformed.x, transformed.y, mapProjection);
                } else {
                    this.currentMapCoordinate = inputCoordinates;
                }

                this.transformedCoordinate = inputCoordinates;
                this._updateFields();
                this._showFeature();
            }
        }
    });

})(jQuery);



