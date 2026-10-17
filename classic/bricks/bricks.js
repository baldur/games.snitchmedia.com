$(function() {
    var randomColor = function() {
        randomNumbers = [];
        for(var ii = 0 ; ii<6 ; ii++) {
            randomNumbers.push(Math.floor(Math.random(1)*16).toString(16));
        }
        return "#" + randomNumbers.join('');
    } 

    var $brick = $('<div>');
    $brick.attr('class', 'brick');
    for(var i = 0; i<100; i++) {
        $('#field').prepend($brick.clone().css('background',randomColor));
    }

    var brickPositions = [];
    $('.brick').each(function() {
        // record position
        brickPositions.push({left: $(this).position().left, top: $(this).position().top});
    });
    var count = 0;
    $('.brick').each(function() {
        //move positions
        $(this).css({'float': 'none', 'top': brickPositions[count].top, 'left': brickPositions[count].left, 'position': 'absolute'});
        count++
    });
});

$(function() {
    var direction = [1, -1], distance = 5;
    var pid = setInterval(function() {
        var $ball = $('#ball'),
            $field = $('#field'),
            $paddle = $('#paddle'),
            currentPos = [ parseInt( $ball.css( 'left' ), 10 ), 
                           parseInt( $ball.css( 'top' ), 10 ) ];

        var paddleHit = function(paddle, pos, field) {
            var leftPos = parseInt( paddle.css( 'left' ), 10 ),
                rightPos = parseInt( paddle.css( 'width' ), 10 ) + leftPos;
                                                                                       // paddle
                                                                                       // height
            return ( pos[0] >= leftPos && pos[0] < rightPos && pos[1] === field.height() - 5 ); 
        }

        var ballOut = function(pos, field) {
            return ( pos[1] > field.height() );
        };

        var upperWallHit = function(pos) {
            return ( pos[1] < 0 );
        };

        var rightWallHit = function(pos, field, dist) {
            return ( pos[0] > field.width() - dist * 2 );
        };

        var leftWallHit = function(pos, dist) {
            return ( pos[0] < 0 + dist );
        };

        var gameOver = function() {
            // implement something cool here ;)
            alert( 'Game Over' );
        };

        if( upperWallHit( currentPos ) ) {
            direction[1] = 1;
        }

        if( rightWallHit( currentPos, $field, distance ) ) {
            direction[0] = -1;
        }

        if( leftWallHit( currentPos, distance ) ) {
            direction[0] = 1;
        }
        
        if( paddleHit( $paddle, currentPos, $field  ) ) {
            direction[1] = -1;
        }

        var brickHit = function(pos) {
            $('.brick').each(function(count, el) { 
                    var $el = $(el),
                        topSide = $el.position().top,
                        bottomSide = $el.height() + $el.position().top,
                        leftSide = $el.position().left,
                        rightSide = $el.width() + $el.position().left
                if( (pos[1] <= bottomSide && pos[1] >= topSide) && (pos[0] >= leftSide && pos[0] <= rightSide ) ) {
                    $el.remove();
                    if(pos[1] === bottomSide || pos[1] === topSide) {
                        direction[1] *= -1;
                    } else if (pos[0] === leftSide || pos[0] === rightSide) {
                        direction[0] *= -1;
                    }
                }
            });
        };

        brickHit( currentPos );

        if( ballOut( currentPos, $field ) ) {
            gameOver();
            clearInterval( pid );
        }

        var newLeft = currentPos[0] + (direction[0]*distance);
        var newTop = currentPos[1] + (direction[1]*distance);
        $ball.css('left', newLeft);
        $ball.css('top', newTop);
    }, 30);

});

$(function() {

    var pid;
    var alreadyMoving = false;
    var direction;
    var startMove = function(dir) {
        alreadyMoving = true;
        direction = dir;
        pid = setInterval(function(){ 
            $paddle = $('#paddle'); 
            var leftPos = parseInt( $paddle.css( 'left' ), 10 );
            if( (leftPos > 0 && direction < 0) || (leftPos < $('#field').width() - $paddle.width() && direction > 0) ) {
                $paddle.css( 'left', leftPos + ( 15*direction ) ); 
            }
        }, 20);
    };

    var goingRight = function(state) {
        if(state === 'stop') {
            alreadyMoving = false;
            clearInterval(pid);
        } else if(state === 'start') {
            if(!alreadyMoving) {
                startMove(1);
            }
        }
    };

    var goingLeft = function(state) {
        if(state === 'stop') {
            alreadyMoving = false;
            clearInterval(pid);
        } else if(state === 'start') {
            if(!alreadyMoving) {
                startMove(-1);
            }
        }
    };

    var directions = { 37  : goingLeft,
                       39  : goingRight };


    $(document).keydown(function(e) {
        func = directions[e.which];
        if( func ) {
            func('start');
            e.preventDefault();
        }
    });

    $(document).keyup(function(e) {
        func = directions[e.which];
        if( func ) {
            func('stop');
            e.preventDefault();
        }
    });

});

