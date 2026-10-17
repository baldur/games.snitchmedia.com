var startGame = function(){

    var direction = [1, -1], distance = 5;
    var pid = setInterval(function() {
        var $ball = $('#ball'),
            $field = $('#field'),
            $leftPaddle = $('#left_paddle'),
            $rightPaddle = $('#right_paddle'),
            currentPos = [ parseInt( $ball.css( 'left' ), 10 ), 
                           parseInt( $ball.css( 'top' ), 10 ) ];

        var paddleHit = function(paddle, pos) {
            var topPos = parseInt( paddle.css( 'top' ), 10 ),
                bottomPos = parseInt( paddle.css( 'height' ), 10 ) + topPos;
            return ( pos[1] >= topPos && pos[1] < bottomPos ); 
        }

        var leftPaddleHit = function(pos, paddle, dist) {
            return ( pos[0] < parseInt( paddle.css( 'left' ), 10 ) + dist && paddleHit( paddle, pos ) );
        };

        var rightPaddleHit = function(pos, paddle, dist, field) {
            return ( pos[0] > field.width() - dist * 2 && paddleHit( paddle, pos ) );
        };

        var ballOut = function(pos, field) {
            return ( pos[0] < 0 || pos[0] > field.width() );
        };

        var upperWallHit = function(pos) {
            return ( pos[1] < 0 );
        };

        var lowerWallHit = function(pos, field, dist) {
            return ( pos[1] > field.height() - dist * 2 );
        };

        var gameOver = function() {
            // implement something cool here ;)
            alert( 'Game Over' );
        };

        if( leftPaddleHit( currentPos, $leftPaddle, distance ) ) {
            direction[0] = 1;
        }

        if( rightPaddleHit( currentPos, $rightPaddle, distance, $field ) ) {
            direction[0] = -1;
        }

        if( upperWallHit( currentPos ) ) {
            direction[1] = 1;
        }

        if( lowerWallHit( currentPos, $field, distance ) ) {
            direction[1] = -1;
        }

        if( ballOut( currentPos, $field ) ) {
            gameOver();
            clearInterval( pid );
        }

        var newLeft = currentPos[0] + (direction[0]*distance);
        var newTop = currentPos[1] + (direction[1]*distance);
        $ball.css('left', newLeft);
        $ball.css('top', newTop);
    }, 30);

};

$(function(){
    $("#start_game").click(function(e){
        startGame();
        e.preventDefault();
    });
    var pids = {
        left_paddle: undefined,
        right_paddle: undefined
    };
    var startMove = function(paddle, direction) {
        pids[paddle.attr('id')] = setInterval(function(){ 
            var topPos = parseInt( paddle.css( 'top' ), 10 );
            paddle.css( 'top', topPos + ( 15*direction ) ); 
        }, 70)
    };
    // a z move left up and down
    // / ' move right up and down

    var leftIsDown = false,
        leftIsUp = false,
        rightIsDown = false,
        rightIsUp = false;

    $(document).keydown(function(e) {
        var leftUp = function(){ 
            if(!leftIsUp) {
                startMove($('#left_paddle'), -1);
                leftIsUp = true;
            }
        };
        var leftDown = function(){
            if(!leftIsDown) {
                startMove($('#left_paddle'), 1);
                leftIsDown = true;
            }
        };
        var rightUp = function(){
            if(!rightIsUp) {
                startMove($('#right_paddle'), -1);
                rightIsUp = true;
            }
        };
        var rightDown = function(){
            if(!rightIsDown) {
                startMove($('#right_paddle'), 1);
                rightIsDown = true;
            }
        };
        var directions = { 65  : leftUp,
                           90  : leftDown,
                           191 : rightDown,
                           222 : rightUp };

        func = directions[e.which];
        if( func ) {
            func();
            e.preventDefault();
        }
    });

    $(document).keyup(function(e) {
        var falsifyLeft = function() {
            leftIsUp = false;
            leftIsDown = false;
        };
        var falsifyRight = function() {
            rightIsUp = false;
            rightIsDown = false;
        };
        var stopLeftUp = function(){
            clearInterval( pids.left_paddle );
            falsifyLeft();
        };
        var stopLeftDown = function(){
            clearInterval( pids.left_paddle );
            falsifyLeft();
        };
        var stopRightUp = function() {
            clearInterval( pids.right_paddle );
            falsifyRight();
        };
        var stopRightDown = function() {
            clearInterval( pids.right_paddle );
            falsifyRight();
        };
        var directions = { 65  : stopLeftUp,
                           90  : stopLeftDown,
                           191 : stopRightUp,
                           222 : stopRightDown };

        func = directions[e.which];
        if( func ) {
            func();
            e.preventDefault();
        }
    });
});

